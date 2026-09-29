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

const SYSTEM = `You are RESQORA, an emergency triage model used while help is being dispatched.
Read the caller's description of what happened and respond ONLY with compact JSON:
{"emergencyType":"accident|fire|medical|crime|natural|sos","severity":"low|medium|high|critical","confidence":0-100,"summary":"one sentence","recommendedResponse":"which services should respond and why, one sentence","firstAid":["short imperative step"]}
Give 3-5 firstAid steps that a bystander can safely perform right now. Never tell the user to delay calling emergency services.`;

export const analyzeEmergencyDescription = createServerFn({ method: "POST" })
  .inputValidator((input: unknown) => Input.parse(input))
  .handler(async ({ data }): Promise<EmergencyAnalysis> => {
    const { guardPaidEndpoint } = await import("@/lib/paid-guard.server");
    await guardPaidEndpoint("analyzeEmergencyDescription");
    const key = process.env.LOVABLE_API_KEY;
    if (!key) throw new Error("AI is not configured");

    const response = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: { "content-type": "application/json", "Lovable-API-Key": key },
      body: JSON.stringify({
        model: "google/gemini-3.6-flash",
        messages: [
          { role: "system", content: SYSTEM },
          { role: "user", content: data.description },
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

    const parsed = JSON.parse(match[0]) as Partial<EmergencyAnalysis>;
    return {
      emergencyType: (parsed.emergencyType ?? "sos") as EmergencyAnalysis["emergencyType"],
      severity: (parsed.severity ?? "medium") as EmergencyAnalysis["severity"],
      confidence: Math.max(0, Math.min(100, Math.round(Number(parsed.confidence ?? 60)))),
      summary: parsed.summary ?? "Emergency description analysed.",
      recommendedResponse: parsed.recommendedResponse ?? "Emergency services should be contacted.",
      firstAid: Array.isArray(parsed.firstAid) ? parsed.firstAid.slice(0, 6).map(String) : [],
    };
  });
