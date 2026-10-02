/**
 * Deterministic (non-AI) critical-indicator rules. These run independently of
 * any model so AI failure or under-triage can never hide a clearly critical
 * situation. They never diagnose — they only prioritise emergency guidance.
 */
const CRITICAL_PATTERNS: { key: string; pattern: RegExp }[] = [
  { key: "unconscious", pattern: /\b(unconscious|unresponsive|passed out|not waking|fainted|collapsed)\b|बेहोश|స్పృహ/i },
  { key: "not_breathing", pattern: /\b(not breathing|no breathing|stopped breathing|can'?t breathe|cannot breathe|choking)\b|सांस नहीं/i },
  { key: "severe_bleeding", pattern: /\b(severe|heavy|lots of|uncontrolled|spurting)\s+bleed(ing)?\b|\bbleeding (heavily|a lot|badly)\b/i },
  { key: "chest_pain", pattern: /\b(severe|crushing|heavy)?\s*chest pain\b|\bheart attack\b/i },
  { key: "stroke", pattern: /\b(stroke|face drooping|slurred speech|one side (weak|numb))\b/i },
  { key: "fire", pattern: /\b(major fire|house (is )?on fire|building (is )?on fire|trapped in (a )?fire|burning building)\b/i },
  { key: "collapse", pattern: /\b(building collapse|collapsed building|buried|trapped under)\b/i },
  { key: "drowning", pattern: /\b(drown(ing|ed)?)\b/i },
  { key: "electric", pattern: /\b(electrocut\w*|electric shock|live wire)\b/i },
  { key: "anaphylaxis", pattern: /\b(anaphyla\w*|throat (is )?(closing|swelling))\b/i },
  { key: "poisoning", pattern: /\b(poison(ed|ing)?|overdose)\b/i },
];

const SELF_HARM = /\b(suicid\w*|kill myself|end my life|self[- ]harm|hurt myself|want to die)\b/i;

export function detectCriticalSigns(text: string): string[] {
  const t = text.slice(0, 5000);
  return CRITICAL_PATTERNS.filter((p) => p.pattern.test(t)).map((p) => p.key);
}

export function detectSelfHarm(text: string): boolean {
  return SELF_HARM.test(text.slice(0, 5000));
}

/** Human wording for model confidence — not a calibrated medical probability. */
export function confidenceLabel(confidence: number): "High" | "Medium" | "Low" {
  if (confidence >= 75) return "High";
  if (confidence >= 45) return "Medium";
  return "Low";
}
