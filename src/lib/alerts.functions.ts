import { createServerFn } from "@tanstack/react-start";
import { getRequest } from "@tanstack/react-start/server";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

/**
 * Emergency SMS is a paid, abusable channel, so the client is only allowed to
 * name *which* of its own emergencies to alert about. Everything that decides
 * where a message goes — ownership, emergency state, recipients, message body —
 * is resolved on the server from the authenticated session.
 */
const Input = z.object({
  emergencyId: z.string().uuid(),
  kind: z.enum(["alert", "resolved"]),
  /** Optional subset of the caller's own saved contacts. */
  contactIds: z.array(z.string().uuid()).max(10).optional(),
  /** Optional same-origin tracking link; rejected when it points elsewhere. */
  trackingUrl: z.string().url().max(300).optional(),
  address: z.string().max(300).optional(),
});

export type SmsStatus = "pending" | "sending" | "sent" | "delivered" | "failed";

export type SendResult = {
  /** Delivery row id. */
  id: string;
  contactId: string | null;
  status: SmsStatus;
  error?: string;
};

export type SendAlertsResponse = {
  /** false when no SMS provider is connected — the UI falls back to manual channels. */
  configured: boolean;
  /** true when every eligible contact already had this exact alert recorded. */
  alreadySent: boolean;
  results: SendResult[];
};

const MAX_RECIPIENTS = 10;
const PROVIDER_URL = "https://connector-gateway.lovable.dev/gatewayapi/mobile/single";

function safeError(message: string): Error {
  // Deliberately terse: no provider bodies, secrets or stack details leak out.
  return new Error(message);
}

function sameOriginUrl(candidate: string | undefined, request: Request | undefined) {
  if (!candidate) return null;
  try {
    const url = new URL(candidate);
    if (url.protocol !== "https:") return null;
    if (request) {
      const origin = new URL(request.url).origin;
      if (url.origin !== origin) return null;
    }
    return url.toString();
  } catch {
    return null;
  }
}

function buildBody(input: {
  kind: "alert" | "resolved";
  name: string;
  reference: string;
  startedAt: string;
  address: string;
  trackingUrl: string | null;
  latitude: number | null;
  longitude: number | null;
}) {
  if (input.kind === "resolved") {
    return [
      "RESQORA Emergency Resolved",
      `${input.name} has confirmed they are safe.`,
      `Emergency ID: ${input.reference}`,
      `Resolved at: ${new Date().toLocaleString()}`,
      "Live location sharing has been stopped.",
    ].join("\n");
  }
  const coords =
    input.latitude != null && input.longitude != null
      ? `https://www.google.com/maps/search/?api=1&query=${input.latitude},${input.longitude}`
      : null;
  return [
    "RESQORA Emergency Alert",
    `${input.name} may need immediate assistance.`,
    `Address: ${input.address}`,
    `Live location: ${input.trackingUrl ?? coords ?? "Awaiting GPS fix"}`,
    `Time: ${new Date(input.startedAt).toLocaleString()}`,
    `Emergency ID: ${input.reference}`,
  ].join("\n");
}

export const sendEmergencyAlerts = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => Input.parse(input))
  .handler(async ({ data, context }): Promise<SendAlertsResponse> => {
    const { supabase, userId } = context;
    const recordOutcome = async (id: string, status: SmsStatus, error?: string) => {
      await supabase
        .from("emergency_alert_deliveries")
        .update({
          status,
          error: error ?? null,
          sent_at: status === "sent" || status === "delivered" ? new Date().toISOString() : null,
        })
        .eq("id", id);
    };
    const request = getRequest();

    // 1. Rate limiting — per-instance burst guard plus a durable per-user cap.
    if (request) {
      const { enforceLimit } = await import("@/lib/rate-limit.server");
      enforceLimit(request, `sms:${userId}`, 6, 60_000);
    }
    const { count: recentCount } = await supabase
      .from("emergency_alert_deliveries")
      .select("id", { count: "exact", head: true })
      .eq("user_id", userId)
      .eq("channel", "sms")
      .gte("created_at", new Date(Date.now() - 3_600_000).toISOString());
    if ((recentCount ?? 0) >= 40) {
      throw safeError("Rate limit exceeded — too many emergency messages in the last hour.");
    }

    // 2. Ownership + state. RLS scopes this read to the caller's own rows, and
    // the explicit user_id check keeps it correct even if policies change.
    const { data: emergency, error: emergencyError } = await supabase
      .from("emergencies")
      .select("id, user_id, status, started_at, latitude, longitude, address")
      .eq("id", data.emergencyId)
      .maybeSingle();
    if (emergencyError) throw safeError("Invalid request");
    if (!emergency || emergency.user_id !== userId) throw safeError("Emergency not found");
    const closed = emergency.status === "resolved" || emergency.status === "cancelled";
    if (data.kind === "alert" && closed) {
      throw safeError("Invalid request — this emergency is already closed.");
    }

    // 3. Recipients come from the caller's saved contacts only.
    let contactQuery = supabase
      .from("emergency_contacts")
      .select("id, name, phone")
      .eq("user_id", userId)
      .order("is_guardian", { ascending: false })
      .order("position", { ascending: true })
      .limit(MAX_RECIPIENTS);
    if (data.contactIds?.length) contactQuery = contactQuery.in("id", data.contactIds);
    const { data: contacts, error: contactError } = await contactQuery;
    if (contactError) throw safeError("Invalid request");
    const eligible = (contacts ?? []).filter((c) => Boolean(c.phone));
    if (eligible.length === 0) return { configured: true, alreadySent: false, results: [] };

    const { data: profile } = await supabase
      .from("profiles")
      .select("full_name, home_address")
      .eq("id", userId)
      .maybeSingle();

    const message = buildBody({
      kind: data.kind,
      name: profile?.full_name || "A RESQORA user",
      reference: emergency.id.slice(0, 8).toUpperCase(),
      startedAt: emergency.started_at,
      address:
        sanitizeText(data.address) ||
        emergency.address ||
        profile?.home_address ||
        "Address unavailable",
      trackingUrl: sameOriginUrl(data.trackingUrl, request),
      latitude: emergency.latitude,
      longitude: emergency.longitude,
    });

    // 4. Idempotency — the unique index on
    // (emergency_id, kind, channel, contact_id) makes the insert a no-op for an
    // event that already exists, so retries/double taps never resend.
    await supabase.from("emergency_alert_deliveries").upsert(
      eligible.map((contact) => ({
        user_id: userId,
        emergency_id: emergency.id,
        contact_id: contact.id,
        contact_name: contact.name,
        contact_phone: contact.phone,
        channel: "sms",
        status: "pending",
        kind: data.kind,
      })),
      { onConflict: "emergency_id,kind,channel,contact_id", ignoreDuplicates: true },
    );

    const { data: rows, error: rowsError } = await supabase
      .from("emergency_alert_deliveries")
      .select("id, contact_id, contact_phone, status")
      .eq("emergency_id", emergency.id)
      .eq("kind", data.kind)
      .eq("channel", "sms")
      .in(
        "contact_id",
        eligible.map((c) => c.id),
      );
    if (rowsError) throw safeError("Invalid request");

    const results: SendResult[] = [];
    const pending = (rows ?? []).filter(
      (row) => row.status === "pending" || row.status === "failed",
    );
    for (const row of rows ?? []) {
      if (row.status === "sent" || row.status === "delivered") {
        results.push({ id: row.id, contactId: row.contact_id, status: row.status as SmsStatus });
      }
    }
    if (pending.length === 0) {
      return { configured: true, alreadySent: results.length > 0, results };
    }

    // 5. Provider credentials stay server-side; absence is reported, not thrown.
    const lovableKey = process.env.LOVABLE_API_KEY;
    const connectionKey = process.env.GATEWAYAPI_API_KEY;
    if (!lovableKey || !connectionKey) {
      return { configured: false, alreadySent: false, results };
    }
    const authHeaders: Record<string, string> = {
      Authorization: `Bearer ${lovableKey}`,
      "X-Connection-Api-Key": connectionKey,
      "Content-Type": "application/json",
    };


    /**
     * One contact's SMS, start to finish. Each call claims its own delivery row
     * atomically (pending/failed -> sending) so a retry or a second concurrent
     * request can never send the same message twice, and it always resolves —
     * a failure for one contact must not stop the others.
     */
    async function sendOne(row: (typeof pending)[number]): Promise<SendResult | null> {
      // Atomic claim: the status filter is part of the UPDATE, so only one
      // worker can move this row out of pending/failed.
      const { data: claimed } = await supabase
        .from("emergency_alert_deliveries")
        .update({ status: "sending", error: null })
        .eq("id", row.id)
        .in("status", ["pending", "failed"])
        .select("id");
      if (!claimed || claimed.length === 0) {
        // Already being processed elsewhere — do not send a duplicate.
        return null;
      }

      const msisdn = Number((row.contact_phone ?? "").replace(/[^\d]/g, ""));
      if (!msisdn) {
        await recordOutcome(row.id, "failed", "Invalid phone number");
        return {
          id: row.id,
          contactId: row.contact_id,
          status: "failed",
          error: "Invalid phone number",
        };
      }

      try {
        const response = await fetch(PROVIDER_URL, {
          method: "POST",
          headers: authHeaders,
          body: JSON.stringify({
            sender: "RESQORA",
            recipient: msisdn,
            message: message.slice(0, 1000),
          }),
          signal: AbortSignal.timeout(20_000),
        });
        if (!response.ok) {
          const body = await response.text();
          // Provider detail stays in the server log only.
          console.error(`RESQORA SMS failed [${response.status}]: ${body.slice(0, 300)}`);
          await recordOutcome(row.id, "failed", `Provider error ${response.status}`);
          return {
            id: row.id,
            contactId: row.contact_id,
            status: "failed",
            error: `Provider error ${response.status}`,
          };
        }
        // Accepted by the provider — not proof of handset delivery, so this
        // stays "sent"; only a provider delivery receipt may set "delivered".
        await recordOutcome(row.id, "sent");
        return { id: row.id, contactId: row.contact_id, status: "sent" };
      } catch (error) {
        const reason =
          error instanceof Error && error.name === "TimeoutError" ? "Provider timeout" : "Network error";
        await recordOutcome(row.id, "failed", reason);
        return { id: row.id, contactId: row.contact_id, status: "failed", error: reason };
      }
    }

    // Independent recipients go out in parallel — allSettled, so one provider
    // failure never cancels the remaining life-safety notifications.
    const settled = await Promise.allSettled(pending.map((row) => sendOne(row)));
    let skipped = 0;
    for (const outcome of settled) {
      if (outcome.status === "fulfilled") {
        if (outcome.value) results.push(outcome.value);
        else skipped += 1;
      } else {
        console.error("RESQORA SMS worker error", outcome.reason);
      }
    }

    // 6. Audit trail on the emergency timeline (no secrets, no message body).
    const sentCount = results.filter((r) => r.status === "sent").length;
    const attempted = pending.length - skipped;
    await supabase.from("emergency_events").insert({
      emergency_id: emergency.id,
      user_id: userId,
      label: data.kind === "resolved" ? "Resolution SMS dispatched" : "Emergency SMS dispatched",
      detail: `${sentCount} of ${attempted} contact(s) accepted by the SMS provider.`,
    });


    return { configured: true, alreadySent: false, results };
  });

function sanitizeText(value: string | undefined) {
  const clean = Array.from(value ?? "")
    .map((char) => (char.charCodeAt(0) < 32 ? " " : char))
    .join("")
    .trim();
  return clean.slice(0, 300);
}
