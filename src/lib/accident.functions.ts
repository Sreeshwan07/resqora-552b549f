import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import {
  FIRST_AID_FALLBACK,
  type AccidentReport,
  type AccidentSeverity,
  type CoreEmergencyType,
  type HospitalSpecialty,
} from "@/lib/accident";

const Input = z.strictObject({
  // Only base64 image data URLs — a video is reduced to a key frame in-browser.
  imageDataUrl: z
    .string()
    .min(32)
    .max(8_000_000)
    .regex(
      /^data:image\/(jpeg|jpg|png|webp|heic);base64,[A-Za-z0-9+/=\s]+$/,
      "Unsupported image format",
    ),
  mediaKind: z.enum(["photo", "video"]).default("photo"),
  address: z.string().max(300).nullish(),
  capturedAt: z.string().max(40).nullish(),
});

const SYSTEM = `You are RESQORA, an emergency triage vision model supporting first responders.
Examine the accident scene and produce AI-assisted observations only — never a confirmed diagnosis.

Respond ONLY with compact JSON:
{"incidentLabel":"Vehicle collision|Motorcycle crash|Fire|Person lying motionless|Building collapse|Flood|Electrical hazard|Smoke|Road obstruction|other short label",
"emergencyType":"accident|fire|medical|crime|natural|sos",
"severity":"minor|moderate|serious|critical",
"confidence":0-100,
"summary":"one or two factual sentences about what is visible",
"observations":["short visible situation"],
"possibleInjuries":["Possible head injury","Heavy external bleeding","Fracture suspected","Burns suspected","Unconscious victim","Trapped occupant"],
"hazards":["short scene hazard such as fuel leak, live wire, oncoming traffic, smoke"],
"victimCount":number or null,
"hospitalSpecialty":"trauma|cardiac|neuro|burn|pediatric|maternity|general",
"firstAidTitle":"short title",
"firstAid":["one clear imperative step"],
"recommendedActions":["short next action for the reporter"]}

Rules: only list injuries suggested by what is visible, prefix them with "Possible"/"Suspected" wording where uncertain, keep every string under 120 characters, return 3-6 firstAid steps.
If the media shows no emergency, use severity "minor", low confidence and say so in the summary.`;

const SEVERITIES = ["minor", "moderate", "serious", "critical"] as const satisfies readonly AccidentSeverity[];
const TYPES = ["accident", "fire", "medical", "crime", "natural", "sos"] as const satisfies readonly CoreEmergencyType[];
const SPECIALTIES: HospitalSpecialty[] = [
  "trauma",
  "cardiac",
  "neuro",
  "burn",
  "pediatric",
  "maternity",
  "general",
];

function strings(value: unknown, max: number) {
  return Array.isArray(value)
    ? value
        .filter((item): item is string => typeof item === "string")
        .map((item) => item.trim().slice(0, 140))
        .filter(Boolean)
        .slice(0, max)
    : [];
}

/** AI accident analysis → structured emergency medical report. */
export const analyzeAccidentScene = createServerFn({ method: "POST" })
  .inputValidator((input: unknown) => Input.parse(input))
  .handler(async ({ data }): Promise<AccidentReport> => {
    const { guardPaidEndpoint } = await import("@/lib/paid-guard.server");
    await guardPaidEndpoint("analyzeAccidentScene");
    const context = [
      `Media type: ${data.mediaKind}`,
      data.address ? `Reported location: ${data.address}` : null,
      data.capturedAt ? `Captured at: ${data.capturedAt}` : null,
    ]
      .filter(Boolean)
      .join("\n");

    const ai = await import("@/lib/ai-call.server");
    const text = await ai.callAiText(
      "analyzeAccidentScene",
      [
        { role: "system", content: `${SYSTEM}\n${ai.UNTRUSTED_INPUT_RULE}` },
        {
          role: "user",
          content: [
            {
              type: "text",
              text: `Analyse this accident scene for emergency response.\n${context}`,
            },
            { type: "image_url", image_url: { url: data.imageDataUrl } },
          ],
        },
      ],
      { timeoutMs: 30_000 },
    );
    const raw = ai.parseAiJson("analyzeAccidentScene", text);
    // Core classification must be valid; everything else is sanitised below.
    const core = ai.validateAi(
      "analyzeAccidentScene",
      z.object({ emergencyType: z.enum(TYPES), severity: z.enum(SEVERITIES) }).passthrough(),
      raw,
    );
    const parsed = core as Record<string, unknown>;

    const emergencyType: CoreEmergencyType = core.emergencyType;
    const severity: AccidentSeverity = core.severity;
    const fallback = FIRST_AID_FALLBACK[emergencyType];
    const steps = strings(parsed.firstAid, 8);
    const victims = Number(parsed.victimCount);

    return {
      incidentLabel: (typeof parsed.incidentLabel === "string" && parsed.incidentLabel.trim() ? parsed.incidentLabel : "Accident scene").slice(0, 60),
      emergencyType,
      severity,
      confidence: Number.isFinite(Number(parsed.confidence))
        ? Math.max(0, Math.min(100, Math.round(Number(parsed.confidence))))
        : 50,
      summary: (typeof parsed.summary === "string" && parsed.summary.trim() ? parsed.summary : "Emergency scene analysed.").slice(0, 400),
      observations: strings(parsed.observations, 6),
      possibleInjuries: strings(parsed.possibleInjuries, 6),
      hazards: strings(parsed.hazards, 5),
      victimCount:
        Number.isFinite(victims) && victims > 0 ? Math.min(99, Math.round(victims)) : null,
      hospitalSpecialty: (SPECIALTIES as unknown[]).includes(parsed.hospitalSpecialty)
        ? (parsed.hospitalSpecialty as HospitalSpecialty)
        : emergencyType === "fire"
          ? "burn"
          : "trauma",
      firstAid: {
        title: (typeof parsed.firstAidTitle === "string" && parsed.firstAidTitle.trim() ? parsed.firstAidTitle : fallback.title).slice(0, 60),
        steps: steps.length >= 2 ? steps : fallback.steps,
      },
      recommendedActions: strings(parsed.recommendedActions, 5),
    };
  });
