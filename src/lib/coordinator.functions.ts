import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

const Input = z.strictObject({
  type: z.string().min(2).max(40),
  severity: z.string().min(2).max(20),
  notes: z.string().max(1200).optional(),
  address: z.string().max(300).optional(),
  medical: z.string().max(800).optional(),
  services: z.array(z.string().max(160)).max(12).optional(),
  aiFindings: z.string().max(1200).optional(),
});

export type CoordinatorAction = {
  title: string;
  detail: string;
  role: string;
  urgent: boolean;
};

export type CoordinatorPlan = {
  incidentType: string;
  severity: "low" | "medium" | "high" | "critical";
  priority: "green" | "yellow" | "orange" | "red";
  headline: string;
  hospitalType: string;
  etaMinutes: number;
  actions: CoordinatorAction[];
  watchFor: string[];
  generatedAt: string;
};

const SYSTEM = `You are the RESQORA AI Emergency Coordinator. A live emergency is in progress.
Produce an operational action plan for the person on scene and their guardian.
Respond ONLY with compact JSON:
{"incidentType":"short label","severity":"low|medium|high|critical","priority":"green|yellow|orange|red","headline":"one sentence situation read","hospitalType":"e.g. Level 1 trauma centre / cardiac unit / burns unit","etaMinutes":number,"actions":[{"title":"imperative step","detail":"one short sentence","role":"Police|Ambulance|Hospital|Fire & rescue|Guardian|On scene","urgent":true|false}],"watchFor":["deterioration sign"]}
Rules: 4-7 actions ordered by urgency, 2-4 watchFor signs, etaMinutes is a realistic arrival estimate for the nearest listed responder. Never advise delaying emergency services.`;

export const generateActionPlan = createServerFn({ method: "POST" })
  .inputValidator((input: unknown) => Input.parse(input))
  .handler(async ({ data }): Promise<CoordinatorPlan> => {
    const { guardPaidEndpoint } = await import("@/lib/paid-guard.server");
    await guardPaidEndpoint("generateActionPlan");
    const key = process.env["LOVABLE_API_KEY"];
    if (!key) throw new Error("AI is not configured");

    const prompt = [
      `Emergency type: ${data.type}`,
      `Reported severity: ${data.severity}`,
      data.address ? `Location: ${data.address}` : null,
      data.notes ? `Notes from the user: ${data.notes}` : null,
      data.medical ? `Medical profile: ${data.medical}` : null,
      data.aiFindings ? `Earlier AI findings: ${data.aiFindings}` : null,
      data.services?.length ? `Nearby responders: ${data.services.join("; ")}` : null,
    ]
      .filter(Boolean)
      .join("\n");

    const response = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: { "content-type": "application/json", "Lovable-API-Key": key },
      body: JSON.stringify({
        model: "google/gemini-3.6-flash",
        messages: [
          { role: "system", content: SYSTEM },
          { role: "user", content: prompt },
        ],
      }),
    });

    if (response.status === 429)
      throw new Error("AI is busy right now — please retry in a moment.");
    if (response.status === 402) throw new Error("AI credits exhausted for this workspace.");
    if (!response.ok) throw new Error(`Coordinator failed (${response.status})`);

    const payload = (await response.json()) as { choices?: { message?: { content?: string } }[] };
    const text = payload.choices?.[0]?.message?.content ?? "";
    const match = text.match(/\{[\s\S]*\}/);
    if (!match) throw new Error("Could not read the coordination plan");
    const parsed = JSON.parse(match[0]) as Partial<CoordinatorPlan>;

    const actions = Array.isArray(parsed.actions)
      ? parsed.actions.slice(0, 7).map((action) => ({
          title: String(action?.title ?? "Action"),
          detail: String(action?.detail ?? ""),
          role: String(action?.role ?? "On scene"),
          urgent: Boolean(action?.urgent),
        }))
      : [];

    return {
      incidentType: parsed.incidentType ?? data.type,
      severity: (parsed.severity ?? "high") as CoordinatorPlan["severity"],
      priority: (parsed.priority ?? "orange") as CoordinatorPlan["priority"],
      headline: parsed.headline ?? "Live emergency coordination in progress.",
      hospitalType: parsed.hospitalType ?? "Nearest emergency department",
      etaMinutes: Math.max(1, Math.min(120, Math.round(Number(parsed.etaMinutes ?? 12)))),
      actions,
      watchFor: Array.isArray(parsed.watchFor) ? parsed.watchFor.slice(0, 4).map(String) : [],
      generatedAt: new Date().toISOString(),
    };
  });
