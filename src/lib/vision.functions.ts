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

const SYSTEM = `You are RESQORA, an emergency triage vision model. Look at the photo and classify the emergency.
Respond ONLY with compact JSON:
{"emergencyType":"accident|fire|medical|crime|natural|sos","severity":"low|medium|high|critical","confidence":0-100,"summary":"one or two sentences","recommendedActions":["short action"]}
If the photo shows no emergency, use severity "low", a low confidence, and say so in the summary.`;

export const analyzeEmergencyImage = createServerFn({ method: "POST" })
  .inputValidator((input: unknown) => Input.parse(input))
  .handler(async ({ data }): Promise<AccidentAnalysis> => {
    const { guardPaidEndpoint } = await import("@/lib/paid-guard.server");
    await guardPaidEndpoint("analyzeEmergencyImage");
    const key = process.env.LOVABLE_API_KEY;
    if (!key) throw new Error("AI is not configured");

    const response = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: { "content-type": "application/json", "Lovable-API-Key": key },
      body: JSON.stringify({
        model: "google/gemini-3.6-flash",
        messages: [
          { role: "system", content: SYSTEM },
          {
            role: "user",
            content: [
              { type: "text", text: "Analyse this scene for an emergency response." },
              { type: "image_url", image_url: { url: data.imageDataUrl } },
            ],
          },
        ],
      }),
    });

    if (response.status === 429)
      throw new Error("AI is busy right now — please retry in a moment.");
    if (response.status === 402) throw new Error("AI credits exhausted for this workspace.");
    if (!response.ok) throw new Error(`AI analysis failed (${response.status})`);

    const payload = (await response.json()) as { choices?: { message?: { content?: string } }[] };
    const text = payload.choices?.[0]?.message?.content ?? "";
    const match = text.match(/\{[\s\S]*\}/);
    if (!match) throw new Error("Could not read the AI analysis");

    const parsed = JSON.parse(match[0]) as Partial<AccidentAnalysis>;
    return {
      emergencyType: (parsed.emergencyType ?? "sos") as AccidentAnalysis["emergencyType"],
      severity: (parsed.severity ?? "medium") as AccidentAnalysis["severity"],
      confidence: Math.max(0, Math.min(100, Math.round(Number(parsed.confidence ?? 60)))),
      summary: parsed.summary ?? "Emergency scene analysed.",
      recommendedActions: Array.isArray(parsed.recommendedActions)
        ? parsed.recommendedActions.slice(0, 5).map(String)
        : [],
    };
  });
