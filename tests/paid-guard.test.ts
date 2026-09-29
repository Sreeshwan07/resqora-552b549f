import { describe, expect, it, vi, beforeAll } from "vitest";

vi.mock("@tanstack/react-start/server", () => ({
  setResponseStatus: vi.fn(),
  getRequest: vi.fn(),
}));

const SECRET = "test-secret-".padEnd(64, "x");
beforeAll(() => {
  process.env["ANON_SESSION_SECRET"] = SECRET;
});

import { issueAnonToken, verifyAnonToken } from "@/lib/anon-session.server";
import { checkPaidEndpoint, GuardError, type GuardDeps } from "@/lib/paid-guard.server";
import { ANON_HEADER, RATE_LIMIT_CONFIG } from "@/lib/rate-limit-config";
import { limitByKey } from "@/lib/rate-limit.server";

/** In-process stand-in for the atomic DB RPC (the real one is covered in rate-limit-db.test.ts). */
function memoryDeps(overrides: Partial<GuardDeps> = {}) {
  const counts = new Map<string, number>();
  const calls: string[] = [];
  const deps: GuardDeps = {
    verifyUser: async (token) => (token === "valid.user.jwt" ? "user-a" : null),
    verifyAnon: (t) => verifyAnonToken(t),
    consume: async (id, ep, _w, max) => {
      calls.push(`${id}|${ep}`);
      const n = (counts.get(`${id}|${ep}`) ?? 0) + 1;
      counts.set(`${id}|${ep}`, n);
      return { allowed: n <= max, retryAfter: 30 };
    },
    ...overrides,
  };
  return { deps, calls };
}

const req = (headers: Record<string, string>) =>
  new Request("http://x/", { method: "POST", headers });

async function status(p: Promise<unknown>) {
  try {
    await p;
    return 200;
  } catch (e) {
    return e instanceof GuardError ? e.status : 500;
  }
}

describe("paid endpoint guard", () => {
  it("TEST 1: authenticated user within limit succeeds", async () => {
    const { deps } = memoryDeps();
    const caller = await checkPaidEndpoint(
      req({ authorization: "Bearer valid.user.jwt" }),
      "analyzeEmergencyDescription",
      deps,
    );
    expect(caller).toEqual({ kind: "user", userId: "user-a" });
  });

  it("TEST 2: authenticated user over limit gets 429", async () => {
    const { deps } = memoryDeps();
    const max = RATE_LIMIT_CONFIG.analyzeEmergencyDescription.authenticated;
    const r = () => req({ authorization: "Bearer valid.user.jwt" });
    for (let i = 0; i < max; i++) await checkPaidEndpoint(r(), "analyzeEmergencyDescription", deps);
    expect(await status(checkPaidEndpoint(r(), "analyzeEmergencyDescription", deps))).toBe(429);
  });

  it("TEST 3: anonymous without valid session is rejected (401), including tampered/expired tokens", async () => {
    const { deps } = memoryDeps();
    expect(await status(checkPaidEndpoint(req({}), "reverseGeocodeFn", deps))).toBe(401);
    expect(
      await status(
        checkPaidEndpoint(req({ [ANON_HEADER]: "plain-anon-id" }), "reverseGeocodeFn", deps),
      ),
    ).toBe(401);
    const { token } = await issueAnonToken();
    const tampered = token.slice(0, 5) + (token[5] === "A" ? "B" : "A") + token.slice(6);
    expect(
      await status(checkPaidEndpoint(req({ [ANON_HEADER]: tampered }), "reverseGeocodeFn", deps)),
    ).toBe(401);
    const old = await issueAnonToken({ now: Date.now() - 2 * 3600_000 });
    expect(
      await status(checkPaidEndpoint(req({ [ANON_HEADER]: old.token }), "reverseGeocodeFn", deps)),
    ).toBe(401);
    const forged = await issueAnonToken({ secret: "attacker-secret".padEnd(64, "y") });
    expect(
      await status(
        checkPaidEndpoint(req({ [ANON_HEADER]: forged.token }), "reverseGeocodeFn", deps),
      ),
    ).toBe(401);
  });

  it("anonymous cannot use auth-only endpoints", async () => {
    const { deps } = memoryDeps();
    const { token } = await issueAnonToken();
    expect(
      await status(checkPaidEndpoint(req({ [ANON_HEADER]: token }), "searchPlacesFn", deps)),
    ).toBe(401);
  });

  it("invalid bearer never silently falls back to anonymous", async () => {
    const { deps } = memoryDeps();
    const { token } = await issueAnonToken();
    const r = req({ authorization: "Bearer bad.user.jwt", [ANON_HEADER]: token });
    expect(await status(checkPaidEndpoint(r, "reverseGeocodeFn", deps))).toBe(401);
  });

  it("TEST 4 + 5: valid anonymous session succeeds, then hits the stricter anon limit", async () => {
    const { deps } = memoryDeps();
    const { token } = await issueAnonToken();
    const max = RATE_LIMIT_CONFIG.analyzeAccidentScene.anonymous!;
    expect(max).toBeLessThan(RATE_LIMIT_CONFIG.analyzeAccidentScene.authenticated);
    for (let i = 0; i < max; i++) {
      const c = await checkPaidEndpoint(
        req({ [ANON_HEADER]: token }),
        "analyzeAccidentScene",
        deps,
      );
      expect(c.kind).toBe("anon");
    }
    expect(
      await status(checkPaidEndpoint(req({ [ANON_HEADER]: token }), "analyzeAccidentScene", deps)),
    ).toBe(429);
  });

  it("TEST 8: changing x-forwarded-for does not change the authenticated bucket", async () => {
    const { deps, calls } = memoryDeps();
    const max = RATE_LIMIT_CONFIG.geocodeAddress.authenticated;
    for (let i = 0; i < max; i++) {
      await checkPaidEndpoint(
        req({
          authorization: "Bearer valid.user.jwt",
          "x-forwarded-for": `10.0.0.${i}`,
          "x-real-ip": `9.9.9.${i}`,
        }),
        "geocodeAddress",
        deps,
      );
    }
    const spoof = req({ authorization: "Bearer valid.user.jwt", "x-forwarded-for": "1.2.3.4" });
    expect(await status(checkPaidEndpoint(spoof, "geocodeAddress", deps))).toBe(429);
    expect(new Set(calls)).toEqual(new Set(["user:user-a|geocodeAddress"]));
  });

  it("TEST 9: client-supplied user ids in headers are ignored", async () => {
    const { deps, calls } = memoryDeps();
    await checkPaidEndpoint(
      req({
        authorization: "Bearer valid.user.jwt",
        "x-user-id": "victim-user",
        "x-resqora-user": "victim-user",
      }),
      "reverseGeocodeFn",
      deps,
    );
    expect(calls[0]).toBe("user:user-a|reverseGeocodeFn");
  });

  it("TEST 10: provider is not called when rate-limited", async () => {
    const { deps } = memoryDeps({ consume: async () => ({ allowed: false, retryAfter: 10 }) });
    const provider = vi.fn();
    const endpoint = async () => {
      await checkPaidEndpoint(
        req({ authorization: "Bearer valid.user.jwt" }),
        "analyzeEmergencyImage",
        deps,
      );
      provider();
    };
    expect(await status(endpoint())).toBe(429);
    expect(provider).not.toHaveBeenCalled();
  });

  it("TEST 11: limiter storage failure fails closed (503) and provider is not called", async () => {
    const { deps } = memoryDeps({
      consume: async () => {
        throw new Error("db down");
      },
    });
    const provider = vi.fn();
    const endpoint = async () => {
      await checkPaidEndpoint(
        req({ authorization: "Bearer valid.user.jwt" }),
        "generateActionPlan",
        deps,
      );
      provider();
    };
    expect(await status(endpoint())).toBe(503);
    expect(provider).not.toHaveBeenCalled();
  });

  it("AI 429 messages keep the emergency path visible", async () => {
    const { deps } = memoryDeps({ consume: async () => ({ allowed: false, retryAfter: 10 }) });
    await expect(
      checkPaidEndpoint(
        req({ authorization: "Bearer valid.user.jwt" }),
        "analyzeEmergencyDescription",
        deps,
      ),
    ).rejects.toThrow(/112/);
  });

  it("anonymous traffic from a trusted edge IP also hits a per-network cap", async () => {
    const { deps, calls } = memoryDeps();
    const { token } = await issueAnonToken();
    await checkPaidEndpoint(
      req({ [ANON_HEADER]: token, "cf-connecting-ip": "203.0.113.5" }),
      "reverseGeocodeFn",
      deps,
    );
    expect(calls.some((c) => c.startsWith("ip:") && c.endsWith("|anon-network"))).toBe(true);
    expect(calls.join()).not.toContain("203.0.113.5");
  });
});

describe("secondary in-memory limiter", () => {
  it("never globally resets other callers when many keys are created", () => {
    for (let i = 0; i < 3; i++) limitByKey("victim", 3, 60_000);
    expect(limitByKey("victim", 3, 60_000).allowed).toBe(false);
    for (let i = 0; i < 5_100; i++) limitByKey(`attacker-${i}`, 3, 60_000);
    // The old implementation's buckets.clear() would have reset the victim to allowed.
    expect(limitByKey("victim", 3, 60_000).allowed).toBe(false);
  });
});
