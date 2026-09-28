/**
 * Server-side gate for paid AI / Maps endpoints.
 * Order: (input already validated) → identity → permission → durable rate limit.
 * Only when this resolves may the caller contact the external provider.
 */
import { setResponseStatus } from "@tanstack/react-start/server";
import {
  ANON_HEADER,
  ANON_NETWORK_LIMIT,
  EMERGENCY_FALLBACK_HINT,
  GUARD_MESSAGES,
  RATE_LIMIT_CONFIG,
  type PaidEndpoint,
} from "@/lib/rate-limit-config";
import { shortHash, trustedClientIp, verifyAnonToken } from "@/lib/anon-session.server";

export type CallerIdentity = { kind: "user"; userId: string } | { kind: "anon"; sessionHash: string };

export type ConsumeResult = { allowed: boolean; retryAfter: number };

export class GuardError extends Error {
  constructor(
    public status: 401 | 403 | 429 | 503,
    message: string,
  ) {
    super(message);
    this.name = "GuardError";
  }
}

export type GuardDeps = {
  verifyUser: (token: string) => Promise<string | null>;
  verifyAnon: (token: string | null) => Promise<string | null>;
  consume: (identifier: string, endpoint: string, windowSeconds: number, max: number) => Promise<ConsumeResult>;
};

async function defaultVerifyUser(token: string) {
  const url = process.env["SUPABASE_URL"];
  const key = process.env["SUPABASE_PUBLISHABLE_KEY"];
  if (!url || !key) throw new GuardError(503, GUARD_MESSAGES[503]);
  const { createClient } = await import("@supabase/supabase-js");
  const client = createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false, storage: undefined },
  });
  const { data, error } = await client.auth.getUser(token);
  if (error || !data.user) return null;
  return data.user.id;
}

async function defaultConsume(identifier: string, endpoint: string, windowSeconds: number, max: number) {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { data, error } = await supabaseAdmin.rpc("consume_rate_limit", {
    _identifier: identifier,
    _endpoint: endpoint,
    _window_seconds: windowSeconds,
    _max: max,
  });
  if (error || !data) throw new Error("rate limit storage unavailable");
  const row = data as { allowed?: boolean; retry_after?: number };
  return { allowed: row.allowed === true, retryAfter: Number(row.retry_after ?? windowSeconds) };
}

const defaultDeps: GuardDeps = {
  verifyUser: defaultVerifyUser,
  verifyAnon: (token) => verifyAnonToken(token),
  consume: defaultConsume,
};

/** Resolve the caller from server-verified credentials only. Never from body fields. */
export async function resolveCaller(request: Request, deps: GuardDeps): Promise<CallerIdentity | null> {
  const auth = request.headers.get("authorization");
  if (auth?.startsWith("Bearer ")) {
    const token = auth.slice(7).trim();
    // A bearer that looks like a user JWT must validate; a bad one never falls back to anon.
    if (token.split(".").length === 3) {
      const userId = await deps.verifyUser(token);
      if (!userId) throw new GuardError(401, GUARD_MESSAGES[401]);
      return { kind: "user", userId };
    }
  }
  const sid = await deps.verifyAnon(request.headers.get(ANON_HEADER));
  if (sid) return { kind: "anon", sessionHash: await shortHash(sid) };
  return null;
}

async function limited(deps: GuardDeps, id: string, endpoint: string, windowSeconds: number, max: number) {
  let result: ConsumeResult;
  try {
    result = await deps.consume(id, endpoint, windowSeconds, max);
  } catch {
    // Fail closed: never allow unmetered paid calls when the limiter is down.
    throw new GuardError(503, GUARD_MESSAGES[503]);
  }
  return result;
}

export async function checkPaidEndpoint(
  request: Request | undefined,
  endpoint: PaidEndpoint,
  deps: GuardDeps = defaultDeps,
): Promise<CallerIdentity> {
  if (!request) throw new GuardError(401, GUARD_MESSAGES[401]);
  const config = RATE_LIMIT_CONFIG[endpoint];
  const caller = await resolveCaller(request, deps);
  if (!caller) throw new GuardError(401, GUARD_MESSAGES[401]);

  let max: number;
  let identifier: string;
  if (caller.kind === "user") {
    max = config.authenticated;
    identifier = `user:${caller.userId}`;
  } else {
    if (config.anonymous === null) throw new GuardError(401, GUARD_MESSAGES[401]);
    max = config.anonymous;
    identifier = `anon:${caller.sessionHash}`;
  }

  const tooMany = () => {
    const hint = config.kind === "ai" ? ` ${EMERGENCY_FALLBACK_HINT}` : "";
    return new GuardError(429, `${GUARD_MESSAGES[429]}${hint}`);
  };

  const main = await limited(deps, identifier, endpoint, config.windowSeconds, max);
  if (!main.allowed) throw tooMany();

  // Additional abuse signal for anonymous traffic: trusted edge IP only.
  if (caller.kind === "anon") {
    const ip = trustedClientIp(request);
    if (ip) {
      const net = await limited(
        deps,
        `ip:${await shortHash(ip)}`,
        "anon-network",
        ANON_NETWORK_LIMIT.windowSeconds,
        ANON_NETWORK_LIMIT.max,
      );
      if (!net.allowed) throw tooMany();
    }
  }
  return caller;
}

/** Server-function wrapper: sets the HTTP status and throws a safe message. */
export async function guardPaidEndpoint(endpoint: PaidEndpoint): Promise<CallerIdentity> {
  const { getRequest } = await import("@tanstack/react-start/server");
  try {
    return await checkPaidEndpoint(getRequest(), endpoint);
  } catch (error) {
    const status = error instanceof GuardError ? error.status : 503;
    const message = error instanceof GuardError ? error.message : GUARD_MESSAGES[503];
    try {
      setResponseStatus(status);
    } catch {
      /* status is best-effort; the message is authoritative */
    }
    throw new GuardError(status, message);
  }
}

/** Consume a durable bucket for a raw key (used by the anonymous-session issuer). */
export async function consumeRaw(identifier: string, endpoint: string, windowSeconds: number, max: number) {
  return limited(defaultDeps, identifier, endpoint, windowSeconds, max);
}
