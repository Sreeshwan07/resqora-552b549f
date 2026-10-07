/** Truthful location freshness labels used wherever a position is shown. */
export type Freshness = "LIVE" | "RECENT" | "LAST KNOWN" | "UNAVAILABLE";

export const LIVE_MS = 30_000;
export const RECENT_MS = 5 * 60_000;

export function locationFreshness(updatedAt: Date | string | null | undefined, now = Date.now()) {
  if (!updatedAt) return "UNAVAILABLE" as Freshness;
  const t = typeof updatedAt === "string" ? new Date(updatedAt).getTime() : updatedAt.getTime();
  if (!Number.isFinite(t)) return "UNAVAILABLE" as Freshness;
  const age = now - t;
  if (age <= LIVE_MS) return "LIVE" as Freshness;
  if (age <= RECENT_MS) return "RECENT" as Freshness;
  return "LAST KNOWN" as Freshness;
}

export const FRESHNESS_STYLE: Record<Freshness, string> = {
  LIVE: "bg-success/15 text-success",
  RECENT: "bg-info/15 text-info",
  "LAST KNOWN": "bg-warning/15 text-warning",
  UNAVAILABLE: "bg-muted text-muted-foreground",
};

/** Communication states — "SENT" only when the server confirmed it. */
export type CommState = "CONNECTING" | "QUEUED" | "SENDING" | "SENT" | "FAILED" | "UNKNOWN";

export function commStateFromOutcome(
  status: "sent" | "ready" | "unavailable" | "skipped" | "failed",
): CommState {
  if (status === "sent") return "SENT";
  if (status === "failed" || status === "unavailable") return "FAILED";
  if (status === "ready") return "QUEUED";
  return "UNKNOWN";
}
