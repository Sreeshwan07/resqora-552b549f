/**
 * Inbound SMS webhook — the feature-phone entry point into the *existing*
 * RESQORA emergency session.
 *
 * Security model, in order:
 *  1. HMAC-SHA256 signature over the raw body (shared secret with the provider)
 *  2. Replay window on the provider timestamp header
 *  3. Per-IP burst limit
 *  4. Zod validation of the payload
 *  5. `sms_ingest` in the database, keyed on (provider, provider_message_id),
 *     so a provider retry can never open a second emergency
 *  6. Reply SMS through the server-side provider; delivery is recorded as
 *     pending/sent/failed — never "delivered" without a real receipt.
 *
 * No provider secret is ever exposed to the browser.
 */
import { createFileRoute } from "@tanstack/react-router";
import { createHmac, timingSafeEqual } from "crypto";
import { z } from "zod";

const Payload = z
  .object({
    id: z.union([z.string(), z.number()]).optional(),
    messageId: z.union([z.string(), z.number()]).optional(),
    message_id: z.union([z.string(), z.number()]).optional(),
    msisdn: z.union([z.string(), z.number()]).optional(),
    from: z.union([z.string(), z.number()]).optional(),
    sender: z.union([z.string(), z.number()]).optional(),
    message: z.string().max(1000).optional(),
    text: z.string().max(1000).optional(),
    body: z.string().max(1000).optional(),
    timestamp: z.union([z.string(), z.number()]).optional(),
  })
  .passthrough();

const PROVIDER_URL = "https://connector-gateway.lovable.dev/gatewayapi/mobile/single";
const REPLAY_WINDOW_MS = 5 * 60_000;

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function verifySignature(raw: string, header: string | null, secret: string) {
  if (!header) return false;
  const provided = header
    .replace(/^sha256=/i, "")
    .trim()
    .toLowerCase();
  const expected = createHmac("sha256", secret).update(raw).digest("hex");
  if (provided.length !== expected.length) return false;
  try {
    return timingSafeEqual(Buffer.from(provided, "hex"), Buffer.from(expected, "hex"));
  } catch {
    return false;
  }
}

async function sendReply(to: string, message: string) {
  const lovableKey = process.env["LOVABLE_API_KEY"];
  const connectionKey = process.env["GATEWAYAPI_API_KEY"];
  if (!lovableKey || !connectionKey) return { status: "pending" as const, error: "not_configured" };
  const msisdn = Number(to.replace(/\D/g, ""));
  if (!msisdn) return { status: "failed" as const, error: "invalid_recipient" };
  try {
    const response = await fetch(PROVIDER_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${lovableKey}`,
        "X-Connection-Api-Key": connectionKey,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        sender: "RESQORA",
        recipient: msisdn,
        message: message.slice(0, 320),
      }),
      signal: AbortSignal.timeout(20_000),
    });
    if (!response.ok) {
      const detail = await response.text();
      console.error(
        `RESQORA inbound SMS reply failed [${response.status}]: ${detail.slice(0, 200)}`,
      );
      // Accepted by the provider is the strongest claim we can make; a real
      // delivery receipt is required before anything is called "delivered".
      return { status: "failed" as const, error: `provider_${response.status}` };
    }
    return { status: "sent" as const };
  } catch (error) {
    const reason = error instanceof Error && error.name === "TimeoutError" ? "timeout" : "network";
    return { status: "failed" as const, error: reason };
  }
}

/**
 * Turns a landmark the sender typed into real coordinates so nearby volunteers
 * and dispatch can actually be matched. Returns null when the lookup fails —
 * the emergency keeps its written location and is never given invented GPS.
 */
async function geocodeLandmark(place: string) {
  const key = process.env["GOOGLE_MAPS_API_KEY"];
  if (!key) return null;
  try {
    const response = await fetch(
      `https://maps.googleapis.com/maps/api/geocode/json?address=${encodeURIComponent(place)}&key=${key}`,
      { signal: AbortSignal.timeout(10_000) },
    );
    if (!response.ok) return null;
    const payload = (await response.json()) as {
      status?: string;
      results?: { geometry?: { location?: { lat: number; lng: number } } }[];
    };
    const loc = payload.results?.[0]?.geometry?.location;
    if (payload.status !== "OK" || !loc) return null;
    return { lat: loc.lat, lng: loc.lng };
  } catch {
    return null;
  }
}

/**
 * Notifies the emergency contacts of an SMS-raised emergency. Each attempt is
 * recorded with its real outcome (sent/failed); nothing is marked delivered
 * without a provider receipt, and a failure here never affects the emergency.
 */
async function notifySmsContacts(
  admin: { from: (t: string) => any; rpc: (n: string, a: unknown) => any },
  input: { userId: string; emergencyId: string; reference: string; address: string | null },
) {
  const { data: contacts } = await admin
    .from("emergency_contacts")
    .select("id, name, phone")
    .eq("user_id", input.userId)
    .order("position", { ascending: true })
    .limit(5);
  const list = (contacts ?? []) as { id: string; name: string; phone: string }[];
  if (list.length === 0) return 0;

  const message = `RESQORA emergency ${input.reference}: an emergency was reported by SMS${
    input.address ? ` near ${input.address}` : ""
  }. Please try to make contact.`;

  const results = await Promise.allSettled(
    list.map(async (contact) => {
      const outcome = await sendReply(contact.phone, message);
      await admin.from("emergency_alert_deliveries").insert({
        user_id: input.userId,
        emergency_id: input.emergencyId,
        contact_id: contact.id,
        contact_name: contact.name,
        contact_phone: contact.phone,
        channel: "sms",
        kind: "alert",
        status: outcome.status,
        error: outcome.error ?? null,
        sent_at: outcome.status === "sent" ? new Date().toISOString() : null,
      });
      return outcome.status === "sent";
    }),
  );
  return results.filter((r) => r.status === "fulfilled" && r.value).length;
}

export const Route = createFileRoute("/api/public/sms-inbound")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const secret = process.env["SMS_WEBHOOK_SECRET"];
        if (!secret) {
          // Configuration state, reported plainly — nothing is simulated.
          return json({ error: "sms_not_configured" }, 503);
        }

        const raw = await request.text();
        if (raw.length > 8_000) return json({ error: "payload_too_large" }, 413);

        if (!verifySignature(raw, request.headers.get("x-resqora-signature"), secret)) {
          return json({ error: "invalid_signature" }, 401);
        }

        // Replay protection on the provider timestamp header.
        const stamp = request.headers.get("x-resqora-timestamp");
        if (stamp) {
          const at = Number.isNaN(Number(stamp)) ? Date.parse(stamp) : Number(stamp) * 1000;
          if (!Number.isFinite(at) || Math.abs(Date.now() - at) > REPLAY_WINDOW_MS) {
            return json({ error: "stale_request" }, 401);
          }
        }

        const { limitByKey, callerKey } = await import("@/lib/rate-limit.server");
        const limited = limitByKey(callerKey(request, "sms-inbound"), 30, 60_000);
        if (!limited.allowed) {
          return json({ error: "rate_limited", retryAfter: limited.retryAfter }, 429);
        }

        let parsed: z.infer<typeof Payload>;
        try {
          parsed = Payload.parse(JSON.parse(raw));
        } catch {
          return json({ error: "invalid_payload" }, 400);
        }

        const messageId = String(parsed.id ?? parsed.messageId ?? parsed.message_id ?? "");
        const from = String(parsed.msisdn ?? parsed.from ?? parsed.sender ?? "");
        const body = parsed.message ?? parsed.text ?? parsed.body ?? "";
        if (!messageId || !from) return json({ error: "invalid_payload" }, 400);

        const payloadHash = createHmac("sha256", secret).update(raw).digest("hex");

        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
        const { data, error } = await supabaseAdmin.rpc("sms_ingest", {
          _provider: "gatewayapi",
          _message_id: messageId,
          _from: from,
          _body: body,
          _payload_hash: payloadHash,
        });
        if (error) {
          console.error("RESQORA sms_ingest failed", error.message);
          return json({ error: "processing_failed" }, 500);
        }

        const result = (data ?? {}) as {
          duplicate?: boolean;
          reply?: string | null;
          emergency_id?: string | null;
          event_id?: string | null;
        };

        // A retried webhook is acknowledged without sending a second SMS.
        if (result.duplicate) return json({ ok: true, duplicate: true });

        if (result.reply) {
          const outcome = await sendReply(from, result.reply);
          // Only a processed message has a delivery row to update.
          if (result.event_id) {
            await supabaseAdmin.rpc("sms_record_delivery", {
              _event_id: result.event_id,
              _status: outcome.status,
              _error: outcome.error ?? undefined,
            });
          }
        }

        return json({ ok: true, emergencyId: result.emergency_id ?? null });
      },
    },
  },
});
