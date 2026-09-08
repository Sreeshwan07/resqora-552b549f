/**
 * Post-incident recovery and after-action reporting.
 *
 * Everything here is derived from what actually happened: the incident row, its
 * timeline events, the units that were dispatched and the hospital handover.
 * No response time is invented — when a stamp is missing the figure is simply
 * unavailable.
 *
 * Recovery follow-up steps are recorded as timeline events on the incident
 * itself (label prefixed with `Recovery — `), so the incident keeps one single
 * auditable history instead of a parallel one.
 */
import { queryOptions } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import type { IncidentAssignment, HospitalHandoff } from "@/lib/dispatch";
import type { IncidentVictim } from "@/lib/incident";

export const RECOVERY_PREFIX = "Recovery — ";

export type DebriefIncident = {
  id: string;
  public_code: string | null;
  type: string;
  incident_type: string;
  incident_description: string | null;
  severity: string;
  status: string;
  phase: string;
  phase_updated_at: string;
  started_at: string;
  resolved_at: string | null;
  duration_seconds: number | null;
  notified_at: string | null;
  ack_at: string | null;
  ack_by: string | null;
  escalated_at: string | null;
  escalation_level: number;
  victim_count: number;
  is_mass_casualty: boolean;
  is_simulation: boolean;
  address: string | null;
  latitude: number | null;
  longitude: number | null;
  ai_summary: string | null;
  ai_recommendation: string | null;
  resolution_status: string | null;
};

export type IncidentEvent = {
  id: string;
  label: string;
  detail: string | null;
  created_at: string;
};

const INCIDENT_COLUMNS =
  "id, public_code, type, incident_type, incident_description, severity, status, phase, phase_updated_at, started_at, resolved_at, duration_seconds, notified_at, ack_at, ack_by, escalated_at, escalation_level, victim_count, is_mass_casualty, is_simulation, address, latitude, longitude, ai_summary, ai_recommendation, resolution_status";

/** Every incident the signed-in person can see, most recent first. */
export const debriefIncidentsQuery = () =>
  queryOptions({
    queryKey: ["debrief-incidents"],
    staleTime: 15_000,
    queryFn: async (): Promise<DebriefIncident[]> => {
      const { data, error } = await supabase
        .from("emergencies")
        .select(INCIDENT_COLUMNS)
        .order("started_at", { ascending: false })
        .limit(60);
      if (error) throw new Error(error.message);
      return (data ?? []) as unknown as DebriefIncident[];
    },
  });

export const incidentEventsQuery = (emergencyId: string | undefined) =>
  queryOptions({
    queryKey: ["incident-events", emergencyId],
    enabled: Boolean(emergencyId),
    queryFn: async (): Promise<IncidentEvent[]> => {
      const { data, error } = await supabase
        .from("emergency_events")
        .select("id, label, detail, created_at")
        .eq("emergency_id", emergencyId!)
        .order("created_at", { ascending: true });
      if (error) throw new Error(error.message);
      return (data ?? []) as IncidentEvent[];
    },
  });

export const incidentVictimsQuery = (emergencyId: string | undefined) =>
  queryOptions({
    queryKey: ["incident-victims", emergencyId],
    enabled: Boolean(emergencyId),
    queryFn: async (): Promise<IncidentVictim[]> => {
      const { data, error } = await supabase
        .from("emergency_victims")
        .select("*")
        .eq("emergency_id", emergencyId!)
        .order("created_at", { ascending: true });
      if (error) throw new Error(error.message);
      return (data ?? []) as IncidentVictim[];
    },
  });

/* -------------------------------- metrics -------------------------------- */

export type IncidentMetrics = {
  timeToAlertSeconds: number | null;
  timeToAcknowledgeSeconds: number | null;
  timeToDispatchSeconds: number | null;
  timeToOnSceneSeconds: number | null;
  timeToHandoverSeconds: number | null;
  totalDurationSeconds: number | null;
  escalations: number;
  unitsDispatched: number;
  unitsCompleted: number;
};

function seconds(from: string, to: string | null | undefined) {
  if (!to) return null;
  const value = (new Date(to).getTime() - new Date(from).getTime()) / 1000;
  return Number.isFinite(value) && value >= 0 ? Math.round(value) : null;
}

function firstEventTime(events: IncidentEvent[], needle: string) {
  const hit = events.find((event) => event.label.toLowerCase().includes(needle));
  return hit?.created_at ?? null;
}

export function incidentMetrics(
  incident: DebriefIncident,
  events: IncidentEvent[],
  assignments: IncidentAssignment[],
  handoffs: HospitalHandoff[],
): IncidentMetrics {
  const start = incident.started_at;
  const dispatchAt =
    assignments.length > 0
      ? assignments.reduce(
          (earliest, a) => (a.created_at < earliest ? a.created_at : earliest),
          assignments[0].created_at,
        )
      : null;
  const onSceneAt = firstEventTime(events, "on scene") ?? firstEventTime(events, "arrived");
  const handoverAt = handoffs.length ? handoffs[handoffs.length - 1].created_at : null;

  return {
    timeToAlertSeconds: seconds(start, incident.notified_at),
    timeToAcknowledgeSeconds: seconds(start, incident.ack_at),
    timeToDispatchSeconds: seconds(start, dispatchAt),
    timeToOnSceneSeconds: seconds(start, onSceneAt),
    timeToHandoverSeconds: seconds(start, handoverAt),
    totalDurationSeconds:
      incident.duration_seconds ?? seconds(start, incident.resolved_at) ?? null,
    escalations: incident.escalation_level ?? 0,
    unitsDispatched: assignments.length,
    unitsCompleted: assignments.filter((a) => a.status === "completed").length,
  };
}

export function humanSeconds(value: number | null) {
  if (value == null) return "Not recorded";
  if (value < 60) return `${value}s`;
  const minutes = Math.floor(value / 60);
  const rest = value % 60;
  if (minutes < 60) return rest ? `${minutes}m ${rest}s` : `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  return `${hours}h ${minutes % 60}m`;
}

/* ------------------------------- recovery -------------------------------- */

export const RECOVERY_STEPS = [
  {
    key: "family_informed",
    label: "Family and contacts told the outcome",
    detail: "Everyone who was alerted has been told how it ended.",
  },
  {
    key: "medical_followup",
    label: "Medical follow-up arranged",
    detail: "Discharge advice, medication or a follow-up appointment is in place.",
  },
  {
    key: "records_collected",
    label: "Hospital and treatment records collected",
    detail: "Papers, prescriptions and bills gathered for insurance or claims.",
  },
  {
    key: "insurance_claim",
    label: "Insurance or compensation claim started",
    detail: "Claim reference recorded where one applies.",
  },
  {
    key: "property_secured",
    label: "Vehicle, home or property secured",
    detail: "Damage handled, valuables recovered, site made safe.",
  },
  {
    key: "authority_report",
    label: "Report filed with the authorities",
    detail: "Police or civic report lodged if the incident requires one.",
  },
  {
    key: "wellbeing_check",
    label: "Wellbeing check done",
    detail: "Mental-health support or a rest plan agreed for everyone involved.",
  },
  {
    key: "lessons_noted",
    label: "Lessons recorded for next time",
    detail: "What slowed the response down, and what to change.",
  },
] as const;

export type RecoveryStepKey = (typeof RECOVERY_STEPS)[number]["key"];

export function completedRecoverySteps(events: IncidentEvent[]) {
  const done = new Set<string>();
  for (const event of events) {
    if (!event.label.startsWith(RECOVERY_PREFIX)) continue;
    const key = event.label.slice(RECOVERY_PREFIX.length).trim();
    done.add(key);
  }
  return done;
}

/** Records a completed recovery step on the incident's own timeline. */
export async function markRecoveryStep(
  emergencyId: string,
  step: RecoveryStepKey,
  note?: string,
) {
  const { data: auth } = await supabase.auth.getUser();
  const userId = auth.user?.id;
  if (!userId) throw new Error("You need to be signed in.");
  const meta = RECOVERY_STEPS.find((entry) => entry.key === step);
  const { error } = await supabase.from("emergency_events").insert({
    emergency_id: emergencyId,
    user_id: userId,
    label: `${RECOVERY_PREFIX}${step}`,
    detail: note?.trim() ? note.trim() : (meta?.label ?? null),
  });
  if (error) throw new Error(error.message);
}
