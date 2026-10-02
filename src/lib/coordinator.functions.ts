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

const str = (max: number) => z.string().trim().min(1).max(max);
const PlanSchema = z.object({
  incidentType: str(80).optional().catch(undefined),
  severity: z.enum(["low", "medium", "high", "critical"]),
  priority: z.enum(["green", "yellow", "orange", "red"]),
  headline: str(400).catch("Live emergency coordination in progress."),
  hospitalType: str(120).catch("Nearest emergency department"),
  etaMinutes: z.coerce.number().catch(12).transform((n) => Math.max(1, Math.min(120, Math.round(n)))),
  actions: z
    .array(
      z
        .object({
          title: str(160),
          detail: z.string().trim().max(400).catch(""),
          role: str(40).catch("On scene"),
          urgent: z.boolean().catch(false),
        })
        .nullable()
        .catch(null),
    )
    .catch([])
    .transform((a) => a.slice(0, 7)),
  watchFor: z
    .array(z.string().trim().max(200).catch(""))
    .catch([])
    .transform((a) => a.slice(0, 4)),
});

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

    const ai = await import("@/lib/ai-call.server");
    const text = await ai.callAiText("generateActionPlan", [
      { role: "system", content: `${SYSTEM}\n${ai.UNTRUSTED_INPUT_RULE}` },
      { role: "user", content: prompt },
    ]);
    const parsed = ai.validateAi(
      "generateActionPlan",
      PlanSchema,
      ai.parseAiJson("generateActionPlan", text),
    );
    // Advisory only: this plan is displayed to the user; it never dispatches,
    // changes emergency state or contacts responders by itself.
    return {
      ...parsed,
      incidentType: parsed.incidentType ?? data.type.slice(0, 80),
      actions: parsed.actions.filter((a): a is CoordinatorAction => a !== null),
      watchFor: parsed.watchFor.filter(Boolean),
      generatedAt: new Date().toISOString(),
    };
  });
