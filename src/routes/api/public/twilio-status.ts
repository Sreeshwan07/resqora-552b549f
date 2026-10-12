/**
 * Twilio delivery-status callback. Only this endpoint, after verifying
 * Twilio's signature, may mark an SMS "delivered" or "failed".
 */
import { createFileRoute } from "@tanstack/react-router";
import { mapTwilioStatus, parseTwilioForm, verifyTwilioSignature } from "@/lib/twilio";

export const Route = createFileRoute("/api/public/twilio-status")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const token = process.env["TWILIO_AUTH_TOKEN"]?.trim();
        if (!token) return new Response("SMS provider is not configured", { status: 503 });
        const raw = await request.text();
        if (raw.length > 8_000) return new Response("too large", { status: 413 });
        const params = parseTwilioForm(raw);
        const u = new URL(request.url);
        const host = request.headers.get("x-forwarded-host") ?? u.host;
        const proto = /^(localhost|127\.)/.test(host) ? u.protocol : "https:";
        const url = `${proto}//${host}${u.pathname}${u.search}`;
        if (!verifyTwilioSignature(url, params, request.headers.get("x-twilio-signature"), token)) {
          return new Response("invalid signature", { status: 401 });
        }
        const sid = params["MessageSid"] ?? "";
        const state = mapTwilioStatus(params["MessageStatus"] ?? "");
        if (!/^(SM|MM)[0-9a-f]{32}$/i.test(sid) || !state || state === "sent") {
          return new Response(null, { status: 204 });
        }
        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
        const now = new Date().toISOString();
        await supabaseAdmin
          .from("emergency_alert_deliveries")
          .update(
            state === "delivered"
              ? { status: "delivered", delivered_at: now }
              : { status: "failed", failed_at: now, error: `twilio_${params["ErrorCode"] ?? "undelivered"}`.slice(0, 60) },
          )
          .eq("provider_message_id", sid)
          .eq("channel", "sms");
        return new Response(null, { status: 204 });
      },
    },
  },
});
