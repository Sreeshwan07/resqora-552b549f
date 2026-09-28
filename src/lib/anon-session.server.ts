/**
 * Signed, short-lived anonymous sessions for low-friction emergency access.
 * Token = base64url(payload) + "." + base64url(HMAC-SHA256(payload)).
 * The session id is server-generated random data; clients cannot alter it.
 */
import { ANON_SCOPE, ANON_SESSION_TTL_SECONDS } from "@/lib/rate-limit-config";

type AnonPayload = { sid: string; exp: number; scope: string; v: 1 };

const enc = new TextEncoder();

function b64url(bytes: Uint8Array) {
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
function fromB64url(value: string) {
  const bin = atob(value.replace(/-/g, "+").replace(/_/g, "/"));
  return Uint8Array.from(bin, (c) => c.charCodeAt(0));
}

async function hmacKey(secret: string) {
  return crypto.subtle.importKey("raw", enc.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, [
    "sign",
    "verify",
  ]);
}

function secretOrThrow(secret?: string) {
  const value = secret ?? process.env["ANON_SESSION_SECRET"];
  if (!value || value.length < 32) throw new Error("anon session secret missing");
  return value;
}

export async function issueAnonToken(opts: { secret?: string; now?: number } = {}) {
  const secret = secretOrThrow(opts.secret);
  const now = opts.now ?? Date.now();
  const payload: AnonPayload = {
    sid: b64url(crypto.getRandomValues(new Uint8Array(24))),
    exp: Math.floor(now / 1000) + ANON_SESSION_TTL_SECONDS,
    scope: ANON_SCOPE,
    v: 1,
  };
  const body = b64url(enc.encode(JSON.stringify(payload)));
  const sig = new Uint8Array(await crypto.subtle.sign("HMAC", await hmacKey(secret), enc.encode(body)));
  return { token: `${body}.${b64url(sig)}`, expiresAt: payload.exp };
}

/** Returns the session id only for an untampered, unexpired, correctly scoped token. */
export async function verifyAnonToken(
  token: string | null | undefined,
  opts: { secret?: string; now?: number } = {},
): Promise<string | null> {
  if (!token || token.length > 512) return null;
  const parts = token.split(".");
  if (parts.length !== 2) return null;
  try {
    const secret = secretOrThrow(opts.secret);
    const ok = await crypto.subtle.verify(
      "HMAC",
      await hmacKey(secret),
      fromB64url(parts[1]),
      enc.encode(parts[0]),
    );
    if (!ok) return null;
    const payload = JSON.parse(new TextDecoder().decode(fromB64url(parts[0]))) as AnonPayload;
    const now = Math.floor((opts.now ?? Date.now()) / 1000);
    if (payload.v !== 1 || payload.scope !== ANON_SCOPE) return null;
    if (typeof payload.exp !== "number" || payload.exp <= now) return null;
    if (typeof payload.sid !== "string" || payload.sid.length < 20) return null;
    return payload.sid;
  } catch {
    return null;
  }
}

/** Short one-way hash so logs and bucket keys never contain the raw session id or IP. */
export async function shortHash(value: string) {
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", enc.encode(value)));
  return b64url(digest).slice(0, 22);
}

/** Only the edge-set header is trusted; x-forwarded-for / x-real-ip are client-spoofable. */
export function trustedClientIp(request: Request) {
  return request.headers.get("cf-connecting-ip");
}
