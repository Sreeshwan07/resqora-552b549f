import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

const Input = z.strictObject({
  // Only base64 image data URLs — never an arbitrary URL the server would fetch.
  imageDataUrl: z
    .string()
    .min(32)
    .max(8_000_000)
    .regex(
      /^data:image\/(jpeg|jpg|png|webp|heic);base64,[A-Za-z0-9+/=\s]+$/,
      "Unsupported image format",
    ),
});

export type AccidentAnalysis = {
  emergencyType: "accident" | "fire" | "medical" | "crime" | "natural" | "sos";
  severity: "low" | "medium" | "high" | "critical";
  confidence: number;
  summary: string;
  recommendedActions: string[];
};

const VisionSchema = z.object({
  emergencyType: z.enum(["accident", "fire", "medical", "crime", "natural", "sos"]),
  severity: z.enum(["low", "medium", "high", "critical"]),
  confidence: z.coerce.number().catch(50).transform((n) => Math.max(0, Math.min(100, Math.round(n)))),
  summary: z.string().trim().min(1).max(600).catch("Emergency scene analysed."),
  recommendedActions: z
    .array(z.string().trim().max(300).catch(""))
    .catch([])
    .transform((a) => a.slice(0, 5)),
});

const SYSTEM = `You are RESQORA, an emergency triage vision model. Look at the photo and classify the emergency.
Respond ONLY with compact JSON:
{"emergencyType":"accident|fire|medical|crime|natural|sos","severity":"low|medium|high|critical","confidence":0-100,"summary":"one or two sentences","recommendedActions":["short action"]}
If the photo shows no emergency, use severity "low", a low confidence, and say so in the summary.`;

export const analyzeEmergencyImage = createServerFn({ method: "POST" })
  .inputValidator((input: unknown) => Input.parse(input))
  .handler(async ({ data }): Promise<AccidentAnalysis> => {
    const { guardPaidEndpoint } = await import("@/lib/paid-guard.server");
    await guardPaidEndpoint("analyzeEmergencyImage");
    const ai = await import("@/lib/ai-call.server");
    const text = await ai.callAiText(
      "analyzeEmergencyImage",
      [
        { role: "system", content: `${SYSTEM}\n${ai.UNTRUSTED_INPUT_RULE}` },
        {
          role: "user",
          content: [
            { type: "text", text: "Analyse this scene for an emergency response." },
            { type: "image_url", image_url: { url: data.imageDataUrl } },
          ],
        },
      ],
      { timeoutMs: 30_000 },
    );
    const parsed = ai.validateAi(
      "analyzeEmergencyImage",
      VisionSchema,
      ai.parseAiJson("analyzeEmergencyImage", text),
    );
    return { ...parsed, recommendedActions: parsed.recommendedActions.filter(Boolean) };
  });
