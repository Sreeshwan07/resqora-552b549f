/**
 * Incident backbone — the single source of truth for where an emergency sits in
 * its lifecycle, and for the people involved in it.
 *
 * The authoritative state lives in the database: every phase change goes
 * through the server-side `transition_emergency` function, which authorises the
 * caller, refuses backwards or unknown transitions, stamps the time and writes
 * a timeline event. Nothing here trusts the browser to set a phase directly.
 */
import { supabase } from "@/integrations/supabase/client";

export const INCIDENT_PHASES = [
  { key: "draft", label: "Draft", detail: "Report started but not activated." },
  { key: "activated", label: "Activated", detail: "Incident opened and recorded." },
  { key: "assessing", label: "Assessing", detail: "Location and situation being assessed." },
  { key: "alerting", label: "Alerting", detail: "Contacts and responders being notified." },
  { key: "acknowledged", label: "Acknowledged", detail: "Someone confirmed they are responding." },
  { key: "dispatched", label: "Dispatched", detail: "Help has been assigned to the incident." },
  { key: "en_route", label: "En route", detail: "Help is travelling to the scene." },
  { key: "arrived", label: "On scene", detail: "Help has reached the scene." },
  { key: "patient_transfer", label: "Transfer started", detail: "People are being moved to care." },
  { key: "hospital_handoff", label: "Hospital handoff", detail: "Care handed over at hospital." },
  { key: "recovery", label: "Recovery", detail: "Immediate danger over, follow-up in progress." },
  { key: "resolved", label: "Resolved", detail: "Incident closed." },
] as const;

export type IncidentPhase = (typeof INCIDENT_PHASES)[number]["key"];
export type TerminalPhase = "cancelled" | "failed" | "expired";
export type AnyPhase = IncidentPhase | TerminalPhase;

const TERMINAL_LABELS: Record<TerminalPhase, string> = {
  cancelled: "Cancelled",
  failed: "Failed",
  expired: "Expired",
};

export function phaseRank(phase: string) {
  return INCIDENT_PHASES.findIndex((step) => step.key === phase);
}

export function phaseLabel(phase: string) {
  if (phase in TERMINAL_LABELS) return TERMINAL_LABELS[phase as TerminalPhase];
  const index = phaseRank(phase);
  return index === -1 ? "Unknown" : INCIDENT_PHASES[index].label;
}

export function isClosedPhase(phase: string) {
  return phase === "resolved" || phase in TERMINAL_LABELS;
}

export type TransitionResult = {
  changed: boolean;
  phase: string;
  reason?: string;
  actor?: string;
};

/**
 * Asks the server to move an incident to a new phase. Returns the phase the
 * incident is actually in afterwards — a refused transition is not an error,
 * it simply reports `changed: false`.
 */
export async function transitionIncident(
  emergencyId: string,
  phase: AnyPhase,
  note?: string,
): Promise<TransitionResult> {
  const { data, error } = await supabase.rpc("transition_emergency", {
    _emergency_id: emergencyId,
    _to_phase: phase,
    _note: note ?? null,
  });
  if (error) throw new Error(error.message);
  return (data ?? { changed: false, phase }) as unknown as TransitionResult;
}

/** Fire-and-forget phase update for background workflow steps. */
export function markPhase(emergencyId: string, phase: AnyPhase, note?: string) {
  void transitionIncident(emergencyId, phase, note).catch(() => undefined);
}

/* ------------------------------ people involved ----------------------------- */

export const VICTIM_PRIORITIES = [
  { value: "critical", label: "Critical", tone: "text-destructive" },
  { value: "high", label: "High", tone: "text-orange-600" },
  { value: "moderate", label: "Moderate", tone: "text-amber-600" },
  { value: "low", label: "Low", tone: "text-emerald-600" },
  { value: "safe", label: "Safe", tone: "text-emerald-600" },
  { value: "unknown", label: "Unknown", tone: "text-muted-foreground" },
] as const;

export const VICTIM_STATUSES = [
  { value: "reported", label: "Reported" },
  { value: "assessed", label: "Assessed" },
  { value: "treated_on_scene", label: "Treated on scene" },
  { value: "transferred", label: "Transferred" },
  { value: "safe", label: "Safe" },
] as const;

export type IncidentVictim = {
  id: string;
  emergency_id: string;
  user_id: string;
  label: string;
  priority: string;
  status: string;
  notes: string | null;
  assigned_responder: string | null;
  hospital: string | null;
  created_at: string;
  updated_at: string;
};

export async function listVictims(emergencyId: string): Promise<IncidentVictim[]> {
  const { data, error } = await supabase
    .from("emergency_victims")
    .select("*")
    .eq("emergency_id", emergencyId)
    .order("created_at", { ascending: true });
  if (error) throw new Error(error.message);
  return (data ?? []) as IncidentVictim[];
}

async function syncVictimCount(emergencyId: string) {
  const { count } = await supabase
    .from("emergency_victims")
    .select("id", { count: "exact", head: true })
    .eq("emergency_id", emergencyId);
  if (typeof count === "number") {
    await supabase
      .from("emergencies")
      .update({ victim_count: Math.max(1, count), is_mass_casualty: count > 1 })
      .eq("id", emergencyId);
  }
}

export async function addVictim(input: {
  emergencyId: string;
  userId: string;
  label: string;
  priority?: string;
  notes?: string;
}) {
  const label = input.label.trim().slice(0, 80);
  if (!label) throw new Error("Give this person a short label first.");
  const { data, error } = await supabase
    .from("emergency_victims")
    .insert({
      emergency_id: input.emergencyId,
      user_id: input.userId,
      label,
      priority: input.priority ?? "unknown",
      notes: input.notes?.trim().slice(0, 500) || null,
    })
    .select("*")
    .single();
  if (error) throw new Error(error.message);
  await supabase.from("emergency_events").insert({
    emergency_id: input.emergencyId,
    user_id: input.userId,
    label: "Person added to incident",
    detail: `${label} — priority ${input.priority ?? "unknown"}`,
  });
  await syncVictimCount(input.emergencyId);
  return data as IncidentVictim;
}

export async function updateVictim(
  victim: IncidentVictim,
  patch: Partial<Pick<IncidentVictim, "priority" | "status" | "notes" | "hospital">>,
) {
  const { error } = await supabase.from("emergency_victims").update(patch).eq("id", victim.id);
  if (error) throw new Error(error.message);
  await supabase.from("emergency_events").insert({
    emergency_id: victim.emergency_id,
    user_id: victim.user_id,
    label: "Person updated",
    detail: `${victim.label} — ${Object.entries(patch)
      .map(([key, value]) => `${key}: ${value ?? "—"}`)
      .join(", ")}`,
  });
}

export async function removeVictim(victim: IncidentVictim) {
  const { error } = await supabase.from("emergency_victims").delete().eq("id", victim.id);
  if (error) throw new Error(error.message);
  await syncVictimCount(victim.emergency_id);
}

/** Turns an incident into a mass-casualty / disaster incident (or back). */
export async function setMassCasualty(emergencyId: string, enabled: boolean) {
  const { error } = await supabase
    .from("emergencies")
    .update({ is_mass_casualty: enabled })
    .eq("id", emergencyId);
  if (error) throw new Error(error.message);
}
