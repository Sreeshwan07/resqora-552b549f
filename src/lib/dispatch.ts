/**
 * Coordination layer: response resources, dispatch assignments and hospital
 * handoff.
 *
 * Every state-changing action here goes through a server function
 * (`dispatch_resource`, `update_assignment_status`, `record_hospital_handoff`)
 * so authorisation, double-booking prevention, incident phase advancement and
 * the timeline entry all happen in one atomic place. The browser never writes
 * a resource status or an incident phase directly.
 */
import { queryOptions } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

export const RESOURCE_TYPES = [
  { value: "ambulance", label: "Ambulance" },
  { value: "fire", label: "Fire unit" },
  { value: "police", label: "Police unit" },
  { value: "rescue", label: "Rescue team" },
  { value: "medical_team", label: "Medical team" },
  { value: "shelter", label: "Shelter" },
] as const;

export const RESOURCE_STATUSES = [
  { value: "available", label: "Available" },
  { value: "dispatched", label: "Dispatched" },
  { value: "en_route", label: "En route" },
  { value: "on_scene", label: "On scene" },
  { value: "out_of_service", label: "Out of service" },
] as const;

export const ASSIGNMENT_STATUSES = [
  { value: "assigned", label: "Assigned" },
  { value: "accepted", label: "Accepted" },
  { value: "declined", label: "Declined" },
  { value: "en_route", label: "En route" },
  { value: "on_scene", label: "On scene" },
  { value: "completed", label: "Completed" },
] as const;

export type AssignmentStatus = (typeof ASSIGNMENT_STATUSES)[number]["value"];

export type ResponseResource = {
  id: string;
  name: string;
  resource_type: string;
  identifier: string | null;
  organisation: string | null;
  capacity: number;
  status: string;
  latitude: number | null;
  longitude: number | null;
  base_location: string | null;
  assigned_emergency_id: string | null;
  is_simulation: boolean;
  active: boolean;
};

export type IncidentAssignment = {
  id: string;
  emergency_id: string;
  resource_id: string | null;
  resource_name: string;
  resource_type: string;
  status: string;
  eta_minutes: number | null;
  notes: string | null;
  accepted_at: string | null;
  completed_at: string | null;
  created_at: string;
};

export type HospitalHandoff = {
  id: string;
  emergency_id: string;
  hospital_name: string;
  department: string | null;
  bed_or_ward: string | null;
  expected_arrival: string | null;
  status: string;
  handover_notes: string | null;
  received_by: string | null;
  received_at: string | null;
  created_at: string;
};

export function resourceTypeLabel(type: string) {
  return RESOURCE_TYPES.find((entry) => entry.value === type)?.label ?? type;
}

export function resourceStatusLabel(status: string) {
  return RESOURCE_STATUSES.find((entry) => entry.value === status)?.label ?? status;
}

export function assignmentStatusLabel(status: string) {
  return ASSIGNMENT_STATUSES.find((entry) => entry.value === status)?.label ?? status;
}

/** Every active resource, freshest first. Readable by any signed-in member. */
export const resourcesQuery = () =>
  queryOptions({
    queryKey: ["response-resources"],
    staleTime: 10_000,
    queryFn: async (): Promise<ResponseResource[]> => {
      const { data, error } = await supabase
        .from("response_resources")
        .select(
          "id, name, resource_type, identifier, organisation, capacity, status, latitude, longitude, base_location, assigned_emergency_id, is_simulation, active",
        )
        .eq("active", true)
        .order("status", { ascending: true })
        .order("name", { ascending: true });
      if (error) throw new Error(error.message);
      return (data ?? []) as ResponseResource[];
    },
  });

export const assignmentsQuery = (emergencyId: string | undefined) =>
  queryOptions({
    queryKey: ["incident-assignments", emergencyId],
    enabled: Boolean(emergencyId),
    queryFn: async (): Promise<IncidentAssignment[]> => {
      const { data, error } = await supabase
        .from("incident_assignments")
        .select(
          "id, emergency_id, resource_id, resource_name, resource_type, status, eta_minutes, notes, accepted_at, completed_at, created_at",
        )
        .eq("emergency_id", emergencyId!)
        .order("created_at", { ascending: false });
      if (error) throw new Error(error.message);
      return (data ?? []) as IncidentAssignment[];
    },
  });

export const handoffsQuery = (emergencyId: string | undefined) =>
  queryOptions({
    queryKey: ["hospital-handoffs", emergencyId],
    enabled: Boolean(emergencyId),
    queryFn: async (): Promise<HospitalHandoff[]> => {
      const { data, error } = await supabase
        .from("hospital_handoffs")
        .select(
          "id, emergency_id, hospital_name, department, bed_or_ward, expected_arrival, status, handover_notes, received_by, received_at, created_at",
        )
        .eq("emergency_id", emergencyId!)
        .order("created_at", { ascending: false });
      if (error) throw new Error(error.message);
      return (data ?? []) as HospitalHandoff[];
    },
  });

/** Assignments waiting on the signed-in responder. */
export const myAssignmentsQuery = (userId: string | undefined) =>
  queryOptions({
    queryKey: ["my-assignments", userId],
    enabled: Boolean(userId),
    refetchInterval: 15_000,
    queryFn: async (): Promise<IncidentAssignment[]> => {
      const { data, error } = await supabase
        .from("incident_assignments")
        .select(
          "id, emergency_id, resource_id, resource_name, resource_type, status, eta_minutes, notes, accepted_at, completed_at, created_at",
        )
        .eq("responder_user_id", userId!)
        .not("status", "in", "(completed,declined)")
        .order("created_at", { ascending: false });
      if (error) throw new Error(error.message);
      return (data ?? []) as IncidentAssignment[];
    },
  });

export async function dispatchResource(
  emergencyId: string,
  resourceId: string,
  etaMinutes?: number | null,
  notes?: string | null,
) {
  const { data, error } = await supabase.rpc("dispatch_resource", {
    _emergency_id: emergencyId,
    _resource_id: resourceId,
    _eta_minutes: etaMinutes ?? undefined,
    _notes: notes ?? undefined,
  });
  if (error) throw new Error(error.message);
  return data as { assignment_id: string; resource: string; status: string };
}

export async function setAssignmentStatus(
  assignmentId: string,
  status: AssignmentStatus,
  etaMinutes?: number | null,
) {
  const { data, error } = await supabase.rpc("update_assignment_status", {
    _assignment_id: assignmentId,
    _status: status,
    _eta_minutes: etaMinutes ?? undefined,
  });
  if (error) throw new Error(error.message);
  return data as { id: string; status: string };
}

export async function recordHospitalHandoff(input: {
  emergencyId: string;
  hospital: string;
  department?: string | null;
  bed?: string | null;
  expectedArrival?: string | null;
  notes?: string | null;
}) {
  const { data, error } = await supabase.rpc("record_hospital_handoff", {
    _emergency_id: input.emergencyId,
    _hospital: input.hospital,
    _department: input.department ?? undefined,
    _bed: input.bed ?? undefined,
    _eta: input.expectedArrival ?? undefined,
    _notes: input.notes ?? undefined,
  });
  if (error) throw new Error(error.message);
  return data as { id: string; hospital: string; status: string };
}
