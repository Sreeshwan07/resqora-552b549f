import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

const Input = z.strictObject({
  description: z.string().min(3).max(2000),
});

export type EmergencyAnalysis = {
  emergencyType: "accident" | "fire" | "medical" | "crime" | "natural" | "sos";
  severity: "low" | "medium" | "high" | "critical";
  confidence: number;
  summary: string;
  recommendedResponse: string;
  firstAid: string[];
};

const AnalysisSchema = z.object({
  emergencyType: z.enum(["accident", "fire", "medical", "crime", "natural", "sos"]),
  severity: z.enum(["low", "medium", "high", "critical"]),
  confidence: z.coerce
    .number()
    .catch(50)
    .transform((n) => Math.max(0, Math.min(100, Math.round(n)))),
  summary: z.string().trim().min(1).max(600).catch("Emergency description analysed."),
  recommendedResponse: z
    .string()
    .trim()
    .min(1)
    .max(600)
    .catch("Emergency services should be contacted."),
  firstAid: z
    .array(z.string().trim().max(300).catch(""))
    .catch([])
    .transform((a) => a.slice(0, 6)),
});

const SYSTEM = `You are RESQORA, an emergency triage model used while help is being dispatched.
Read the caller's description of what happened and respond ONLY with compact JSON:
{"emergencyType":"accident|fire|medical|crime|natural|sos","severity":"low|medium|high|critical","confidence":0-100,"summary":"one sentence","recommendedResponse":"which services should respond and why, one sentence","firstAid":["short imperative step"]}
Give 3-5 firstAid steps that a bystander can safely perform right now. Never tell the user to delay calling emergency services.`;

export const analyzeEmergencyDescription = createServerFn({ method: "POST" })
  .inputValidator((input: unknown) => Input.parse(input))
  .handler(async ({ data }): Promise<EmergencyAnalysis> => {
    const { guardPaidEndpoint } = await import("@/lib/paid-guard.server");
    await guardPaidEndpoint("analyzeEmergencyDescription");
    const ai = await import("@/lib/ai-call.server");
    const text = await ai.callAiText("analyzeEmergencyDescription", [
      { role: "system", content: `${SYSTEM}\n${ai.UNTRUSTED_INPUT_RULE}` },
      { role: "user", content: data.description },
    ]);
    const parsed = ai.validateAi(
      "analyzeEmergencyDescription",
      AnalysisSchema,
      ai.parseAiJson("analyzeEmergencyDescription", text),
    );
    return { ...parsed, firstAid: parsed.firstAid.filter(Boolean) };
  });
