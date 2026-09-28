/**
 * Per-instance burst guard (secondary only). Paid AI/Maps endpoints use the
 * durable database limiter in paid-guard.server.ts; this remains for non-paid
 * callers (SMS webhook, alerts, MedAI) that also have durable DB-side caps.
 *
 * No global reset: when the map is full, only the oldest idle keys are evicted,
 * so one caller churning keys can never wipe everyone else's counters.
 */
const buckets = new Map<string, number[]>();
const MAX_KEYS = 5_000;
const MAX_WINDOW_MS = 10 * 60_000;

export type ServerRateLimit = { allowed: true } | { allowed: false; retryAfter: number };

function evict(now: number) {
  for (const [key, hits] of buckets) {
    if (buckets.size <= MAX_KEYS) return;
    if (!hits.length || now - hits[hits.length - 1] > MAX_WINDOW_MS) buckets.delete(key);
  }
  // Still full: drop the least-recently-inserted keys one at a time.
  for (const key of buckets.keys()) {
    if (buckets.size <= MAX_KEYS) return;
    buckets.delete(key);
  }
}

export function limitByKey(key: string, max: number, windowMs: number): ServerRateLimit {
  const now = Date.now();
  const hits = (buckets.get(key) ?? []).filter((at) => now - at < windowMs);
  buckets.delete(key); // re-insert to keep Map order ≈ recency
  if (hits.length >= max) {
    buckets.set(key, hits);
    return { allowed: false, retryAfter: Math.ceil((windowMs - (now - hits[0])) / 1000) };
  }
  hits.push(now);
  buckets.set(key, hits);
  if (buckets.size > MAX_KEYS) evict(now);
  return { allowed: true };
}

/** Trusted edge IP only; spoofable forwarding headers are not used as identity. */
export function callerKey(request: Request, scope: string) {
  return `${scope}:${request.headers.get("cf-connecting-ip") ?? "unknown"}`;
}

export function enforceLimit(request: Request, scope: string, max: number, windowMs: number) {
  const result = limitByKey(callerKey(request, scope), max, windowMs);
  if (!result.allowed) {
    throw new Error("Too many requests. Please try again shortly.");
  }
}
