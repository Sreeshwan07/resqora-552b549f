/**
 * Central rate-limit policy for paid AI / Google Maps endpoints.
 * `anonymous: null` means the endpoint requires a signed-in account.
 * Vision calls are the most expensive, so they get the tightest caps.
 */
export type PaidEndpoint =
  | "analyzeEmergencyImage"
  | "analyzeAccidentScene"
  | "analyzeEmergencyDescription"
  | "generateActionPlan"
  | "fetchNearbyServices"
  | "geocodeAddress"
  | "reverseGeocodeFn"
  | "searchPlacesFn";

export type EndpointLimit = {
  kind: "ai" | "maps";
  windowSeconds: number;
  authenticated: number;
  anonymous: number | null;
};

export const RATE_LIMIT_CONFIG: Record<PaidEndpoint, EndpointLimit> = {
  analyzeEmergencyImage: { kind: "ai", windowSeconds: 60, authenticated: 6, anonymous: 2 },
  analyzeAccidentScene: { kind: "ai", windowSeconds: 60, authenticated: 6, anonymous: 2 },
  analyzeEmergencyDescription: { kind: "ai", windowSeconds: 60, authenticated: 10, anonymous: 4 },
  generateActionPlan: { kind: "ai", windowSeconds: 60, authenticated: 10, anonymous: 3 },
  fetchNearbyServices: { kind: "maps", windowSeconds: 60, authenticated: 30, anonymous: 10 },
  geocodeAddress: { kind: "maps", windowSeconds: 60, authenticated: 20, anonymous: 6 },
  reverseGeocodeFn: { kind: "maps", windowSeconds: 60, authenticated: 30, anonymous: 10 },
  searchPlacesFn: { kind: "maps", windowSeconds: 60, authenticated: 20, anonymous: null },
};

/** Extra per-network cap across all anonymous sessions (trusted edge IP only). */
export const ANON_NETWORK_LIMIT = { windowSeconds: 60, max: 40 };
/** Cap on minting anonymous sessions per trusted network address. */
export const ANON_ISSUE_LIMIT = { windowSeconds: 600, max: 20 };
export const ANON_SESSION_TTL_SECONDS = 30 * 60;
export const ANON_SCOPE = "emergency-paid";
export const ANON_HEADER = "x-resqora-anon";

export const GUARD_MESSAGES = {
  401: "Authentication required.",
  403: "Not authorized for this operation.",
  429: "Too many requests. Please try again shortly.",
  503: "This feature is temporarily unavailable. Please try again shortly.",
} as const;

/** Reminder appended to AI errors so a blocked analysis never reads as "no emergency help". */
export const EMERGENCY_FALLBACK_HINT = "SOS, your emergency contacts and calling 112 still work.";
