/** Shared types + reference data for the AI Accident Response Engine. */

export type AccidentSeverity = "minor" | "moderate" | "serious" | "critical";
export type AccidentPriority = "green" | "yellow" | "orange" | "red";
export type HospitalSpecialty =
  "trauma" | "cardiac" | "neuro" | "burn" | "pediatric" | "maternity" | "general";

/** Emergency types RESQORA already coordinates responders for. */
export type CoreEmergencyType = "accident" | "fire" | "medical" | "crime" | "natural" | "sos";

export type AccidentReport = {
  /** Human label, e.g. "Motorcycle crash". */
  incidentLabel: string;
  emergencyType: CoreEmergencyType;
  severity: AccidentSeverity;
  confidence: number;
  summary: string;
  /** Situations visible in the media, e.g. "Person lying motionless". */
  observations: string[];
  possibleInjuries: string[];
  hazards: string[];
  victimCount: number | null;
  hospitalSpecialty: HospitalSpecialty;
  firstAid: { title: string; steps: string[] };
  recommendedActions: string[];
};

export const SEVERITY_META: Record<
  AccidentSeverity,
  { label: string; priority: AccidentPriority; dot: string; chip: string; ring: string }
> = {
  minor: {
    label: "Minor",
    priority: "green",
    dot: "bg-success",
    chip: "border-success/40 bg-success/10 text-success",
    ring: "border-success/40",
  },
  moderate: {
    label: "Moderate",
    priority: "yellow",
    dot: "bg-warning",
    chip: "border-warning/40 bg-warning/10 text-warning",
    ring: "border-warning/40",
  },
  serious: {
    label: "Serious",
    priority: "orange",
    dot: "bg-warning",
    chip: "border-warning/60 bg-warning/15 text-warning",
    ring: "border-warning/60",
  },
  critical: {
    label: "Critical",
    priority: "red",
    dot: "bg-alert",
    chip: "border-alert/60 bg-alert/15 text-alert",
    ring: "border-alert/60",
  },
};

export const PRIORITY_LABEL: Record<AccidentPriority, string> = {
  green: "GREEN",
  yellow: "YELLOW",
  orange: "ORANGE",
  red: "RED",
};

export function isUrgent(severity: AccidentSeverity) {
  return severity === "serious" || severity === "critical";
}

/** Emergency severity stored on the incident row. */
export function dbSeverity(severity: AccidentSeverity) {
  return severity === "minor"
    ? "low"
    : severity === "moderate"
      ? "medium"
      : severity === "serious"
        ? "high"
        : "critical";
}

export const SPECIALTY_META: Record<
  HospitalSpecialty,
  { label: string; keywords: RegExp; note: string }
> = {
  trauma: {
    label: "Trauma centre",
    keywords: /(trauma|accident|emergency|ortho|general hospital|medical college|multi[- ]?spec)/i,
    note: "Trauma-capable emergency department with surgery and imaging on site.",
  },
  cardiac: {
    label: "Cardiac hospital",
    keywords: /(cardio|cardiac|heart|institute of medical|multi[- ]?spec)/i,
    note: "Cardiac catheterisation and coronary care capability.",
  },
  neuro: {
    label: "Neurology / stroke centre",
    keywords: /(neuro|brain|stroke|institute of medical|multi[- ]?spec)/i,
    note: "Stroke-ready unit with CT imaging and neurology cover.",
  },
  burn: {
    label: "Burns unit",
    keywords: /(burn|plastic|trauma|medical college|multi[- ]?spec)/i,
    note: "Specialised burns dressing and plastic surgery capability.",
  },
  pediatric: {
    label: "Paediatric emergency",
    keywords: /(child|children|paediatr|pediatr|mother and child|kids)/i,
    note: "Paediatric emergency and neonatal support.",
  },
  maternity: {
    label: "Maternity hospital",
    keywords: /(matern|women|obstetr|gynae|gyneco|mother and child)/i,
    note: "Obstetric emergency and delivery capability.",
  },
  general: {
    label: "Emergency hospital",
    keywords: /(hospital|medical cent|emergency)/i,
    note: "24/7 emergency department.",
  },
};

/**
 * Reorders real nearby hospitals so facilities matching the required specialty
 * come first — never invents a facility, never drops the nearest fallback.
 */
export function rankBySpecialty<T extends { name: string; distanceKm: number }>(
  hospitals: T[],
  specialty: HospitalSpecialty,
): T[] {
  const pattern = SPECIALTY_META[specialty].keywords;
  return [...hospitals].sort((a, b) => {
    const ma = pattern.test(a.name) ? 0 : 1;
    const mb = pattern.test(b.name) ? 0 : 1;
    if (ma !== mb) return ma - mb;
    return a.distanceKm - b.distanceKm;
  });
}

/** Emergency numbers used by the one-tap action panel. */
export const EMERGENCY_NUMBERS = [
  { key: "ambulance", label: "Ambulance", phone: "108", emoji: "🚑" },
  { key: "police", label: "Police", phone: "112", emoji: "🚓" },
  { key: "fire", label: "Fire & rescue", phone: "101", emoji: "🚒" },
] as const;

/** Offline-safe first-aid fallback used when the model returns no steps. */
export const FIRST_AID_FALLBACK: Record<CoreEmergencyType, { title: string; steps: string[] }> = {
  accident: {
    title: "Road accident",
    steps: [
      "Make the area safe — switch on hazard lights and keep traffic away.",
      "Do not move seriously injured victims unless they are in danger.",
      "Control severe bleeding with firm direct pressure using a clean cloth.",
      "Keep the victim warm and talk to them continuously.",
      "Monitor breathing until responders arrive.",
    ],
  },
  fire: {
    title: "Fire / burns",
    steps: [
      "Move everyone away from the fire and stay upwind of the smoke.",
      "Cool any burn with clean running water for at least 20 minutes.",
      "Never apply oil, ice or toothpaste to a burn.",
      "Cover the burn loosely with a clean, non-fluffy dressing.",
      "Watch for breathing difficulty from smoke inhalation.",
    ],
  },
  medical: {
    title: "Medical emergency",
    steps: [
      "Keep the person still, sitting or lying in a comfortable position.",
      "Loosen tight clothing and keep the airway clear.",
      "If they are unresponsive and not breathing, start chest compressions at 100–120/min.",
      "Do not give food or water.",
      "Stay with them and report any change to responders.",
    ],
  },
  crime: {
    title: "Violence or assault",
    steps: [
      "Move to a safe, public place — do not confront anyone.",
      "Apply direct pressure to any bleeding wound.",
      "Avoid disturbing the scene.",
      "Note descriptions only when it is safe to do so.",
      "Stay on the line with the police.",
    ],
  },
  natural: {
    title: "Natural disaster",
    steps: [
      "Move to higher or structurally safe ground immediately.",
      "Avoid flooded roads, damaged walls and fallen power lines.",
      "Take drinking water and essential medication with you.",
      "Conserve phone battery for emergency calls.",
      "Follow local authority instructions.",
    ],
  },
  sos: {
    title: "General emergency",
    steps: [
      "Make sure you and bystanders are out of immediate danger.",
      "Check whether the victim is responsive and breathing.",
      "Control heavy bleeding with direct pressure.",
      "Keep the victim still and warm.",
      "Stay on the line with emergency services.",
    ],
  },
};

export const AI_DISCLAIMER =
  "These are AI-assisted observations from the media you shared, not a confirmed medical diagnosis. For any severe or life-threatening situation, contact emergency services immediately.";

/** Short, shareable incident reference. */
export function newIncidentId() {
  const stamp = Date.now().toString(36).toUpperCase().slice(-5);
  const random = Math.random().toString(36).toUpperCase().slice(2, 5);
  return `INC-${stamp}${random}`;
}

export type TimelineEntry = { label: string; detail?: string; at: Date };

/** Shorthand lookup into EMERGENCY_NUMBERS so every screen dials the same numbers. */
export const EMERGENCY_PHONE = {
  ambulance: EMERGENCY_NUMBERS[0].phone,
  police: EMERGENCY_NUMBERS[1].phone,
  fire: EMERGENCY_NUMBERS[2].phone,
} as const;
