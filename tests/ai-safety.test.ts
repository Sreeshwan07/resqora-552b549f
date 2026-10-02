import { afterEach, describe, expect, it, vi } from "vitest";
import { AiError, callAiText, parseAiJson, validateAi } from "@/lib/ai-call.server";
import { confidenceLabel, detectCriticalSigns, detectSelfHarm } from "@/lib/critical-signs";
import { z } from "zod";

const ok = (content: string) =>
  new Response(JSON.stringify({ choices: [{ message: { content } }] }), { status: 200 });

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

async function category(p: Promise<unknown>) {
  try {
    await p;
    return "none";
  } catch (e) {
    expect(e).toBeInstanceOf(AiError);
    expect((e as Error).message).not.toMatch(/SyntaxError|Zod|stack/i);
    return (e as AiError).category;
  }
}

describe("callAiText", () => {
  it("missing key -> AI_UNAVAILABLE", async () => {
    vi.stubEnv("LOVABLE_API_KEY", "");
    expect(await category(callAiText("t", []))).toBe("AI_UNAVAILABLE");
  });
  it("times out -> AI_TIMEOUT, no retry", async () => {
    vi.stubEnv("LOVABLE_API_KEY", "k");
    const f = vi.fn(
      (_u: unknown, init: RequestInit) =>
        new Promise<Response>((_, rej) =>
          init.signal!.addEventListener("abort", () =>
            rej(Object.assign(new Error("t"), { name: "TimeoutError" })),
          ),
        ),
    );
    vi.stubGlobal("fetch", f);
    expect(await category(callAiText("t", [], { timeoutMs: 50 }))).toBe("AI_TIMEOUT");
    expect(f).toHaveBeenCalledTimes(1);
  });
  it("5xx retries once then AI_PROVIDER_ERROR", async () => {
    vi.stubEnv("LOVABLE_API_KEY", "k");
    const f = vi.fn(async () => new Response("x", { status: 503 }));
    vi.stubGlobal("fetch", f);
    expect(await category(callAiText("t", []))).toBe("AI_PROVIDER_ERROR");
    expect(f).toHaveBeenCalledTimes(2);
  });
  it("429 not retried", async () => {
    vi.stubEnv("LOVABLE_API_KEY", "k");
    const f = vi.fn(async () => new Response("x", { status: 429 }));
    vi.stubGlobal("fetch", f);
    expect(await category(callAiText("t", []))).toBe("AI_RATE_LIMITED");
    expect(f).toHaveBeenCalledTimes(1);
  });
  it("network error retried once", async () => {
    vi.stubEnv("LOVABLE_API_KEY", "k");
    const f = vi.fn(async () => {
      throw new TypeError("fetch failed");
    });
    vi.stubGlobal("fetch", f);
    expect(await category(callAiText("t", []))).toBe("AI_NETWORK_ERROR");
    expect(f).toHaveBeenCalledTimes(2);
  });
  it("oversized / empty responses rejected", async () => {
    vi.stubEnv("LOVABLE_API_KEY", "k");
    vi.stubGlobal("fetch", async () => ok("x".repeat(300_000)));
    expect(await category(callAiText("t", []))).toBe("AI_INVALID_RESPONSE");
    vi.stubGlobal("fetch", async () => ok(""));
    expect(await category(callAiText("t", []))).toBe("AI_INVALID_RESPONSE");
  });
  it("success returns text", async () => {
    vi.stubEnv("LOVABLE_API_KEY", "k");
    vi.stubGlobal("fetch", async () => ok('{"a":1}'));
    expect(await callAiText("t", [])).toBe('{"a":1}');
  });
});

describe("parse + validate", () => {
  const S = z.object({ severity: z.enum(["low", "high"]) });
  it("malformed JSON -> AI_INVALID_RESPONSE", async () => {
    expect(await category(Promise.resolve().then(() => parseAiJson("t", "{oops")))).toBe(
      "AI_INVALID_RESPONSE",
    );
  });
  it("invalid enum -> AI_VALIDATION_ERROR", async () => {
    expect(
      await category(Promise.resolve().then(() => validateAi("t", S, { severity: "apocalyptic" }))),
    ).toBe("AI_VALIDATION_ERROR");
  });
  it("valid passes", () => {
    expect(validateAi("t", S, parseAiJson("t", 'note {"severity":"high"} end'))).toEqual({
      severity: "high",
    });
  });
});

describe("deterministic critical signs", () => {
  it("detects critical indicators without AI", () => {
    expect(detectCriticalSigns("my father is unconscious and not breathing")).toEqual(
      expect.arrayContaining(["unconscious", "not_breathing"]),
    );
    expect(detectCriticalSigns("I have a mild headache")).toEqual([]);
    expect(detectSelfHarm("I want to end my life")).toBe(true);
  });
  it("confidence is a label, not a probability", () => {
    expect(confidenceLabel(95)).toBe("High");
    expect(confidenceLabel(50)).toBe("Medium");
    expect(confidenceLabel(10)).toBe("Low");
  });
});
