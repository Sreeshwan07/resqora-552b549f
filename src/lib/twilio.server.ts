/**
 * Server-only Twilio helpers. Credentials are read from process.env inside
 * each call and never leave the server.
 */
import { createHmac, timingSafeEqual } from "crypto";

export function twilioConfigured() {
  const has = (n: string) => Boolean(process.env[n]?.trim());
  return has("TWILIO_ACCOUNT_SID") && has("TWILIO_AUTH_TOKEN") && has("TWILIO_PHONE_NUMBER");
}

/**
 * Twilio request validation: base64(HMAC-SHA1(authToken, url + sorted key/value
 * pairs of the form body)), compared in constant time.
 */
export function verifyTwilioSignature(
  url: string,
  params: Record<string, string>,
  header: string | null,
  authToken: string,
) {
  if (!header) return false;
  const data =
    url +
    Object.keys(params)
      .sort()
      .map((k) => k + params[k])
      .join("");
  const expected = createHmac("sha1", authToken).update(data, "utf8").digest("base64");
  const a = Buffer.from(header.trim());
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

export function parseTwilioForm(raw: string) {
  const params: Record<string, string> = {};
  for (const [k, v] of new URLSearchParams(raw)) params[k] = v;
  return params;
}

export type TwilioSend =
  | { status: "sent"; sid: string }
  | { status: "pending" | "failed"; error: string };

/** "sent" means Twilio accepted it; delivery is only recorded from Twilio's status callback. */
export async function sendTwilioSms(
  to: string,
  body: string,
  statusCallback?: string,
): Promise<TwilioSend> {
  const sid = process.env["TWILIO_ACCOUNT_SID"]?.trim();
  const token = process.env["TWILIO_AUTH_TOKEN"]?.trim();
  const from = process.env["TWILIO_PHONE_NUMBER"]?.trim();
  if (!sid || !token || !from) return { status: "pending", error: "not_configured" };
  const digits = to.replace(/[^\d+]/g, "");
  const e164 = digits.startsWith("+") ? digits : digits.length === 10 ? `+91${digits}` : `+${digits}`;
  if (e164.length < 8) return { status: "failed", error: "invalid_recipient" };
  const form = new URLSearchParams({ To: e164, From: from, Body: body.slice(0, 320) });
  if (statusCallback) form.set("StatusCallback", statusCallback);
  try {
    const res = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${sid}/Messages.json`, {
      method: "POST",
      headers: {
        Authorization: `Basic ${btoa(`${sid}:${token}`)}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: form,
      signal: AbortSignal.timeout(20_000),
    });
    const payload = (await res.json().catch(() => ({}))) as { sid?: string; code?: number };
    if (!res.ok || !payload.sid) {
      console.error(`RESQORA Twilio send failed [${res.status}] code=${payload.code ?? "?"}`);
      return { status: "failed", error: `provider_${res.status}` };
    }
    return { status: "sent", sid: payload.sid };
  } catch (e) {
    return {
      status: "failed",
      error: e instanceof Error && e.name === "TimeoutError" ? "timeout" : "network",
    };
  }
}

/** Maps a Twilio MessageStatus to RESQORA's truthful delivery states. */
export function mapTwilioStatus(s: string): "sent" | "delivered" | "failed" | null {
  if (s === "delivered") return "delivered";
  if (s === "failed" || s === "undelivered") return "failed";
  if (s === "sent" || s === "queued" || s === "accepted" || s === "sending") return "sent";
  return null;
}
