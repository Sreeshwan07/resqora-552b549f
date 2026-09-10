/**
 * Good Samaritan network — opt-in community volunteers attached to the existing
 * emergency session.
 *
 * Everything that decides *who* is eligible, *what* a volunteer may see and
 * *who* claims an exclusive request happens in the database
 * (`request_volunteer_assistance`, `volunteer_requests`,
 * `volunteer_accepted_incidents`, `volunteer_respond`, `volunteer_complete`).
 * The browser never queries other volunteers or unrelated emergencies, and a
 * volunteer never sees an exact address or any medical detail before accepting.
 */
import { queryOptions } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { firstIssue, volunteerSignupSchema } from "@/lib/validation";


export const VOLUNTEER_SKILLS = [
  { value: "first_aid", label: "First Aid" },
  { value: "cpr", label: "CPR" },
  { value: "nurse", label: "Nurse" },
  { value: "doctor", label: "Doctor" },
  { value: "paramedic", label: "Paramedic" },
  { value: "blood_donor", label: "Blood Donor" },
  { value: "disaster_volunteer", label: "Disaster Volunteer" },
  { value: "fire_rescue", label: "Fire/Rescue" },
  { value: "other", label: "Other" },
] as const;

/** Skills that are a professional qualification and therefore need verifying. */
export const PROFESSIONAL_SKILLS = ["nurse", "doctor", "paramedic", "fire_rescue"];

export type VerificationStatus = "pending" | "verified" | "suspended" | "expired" | "rejected";

export const VERIFICATION_LABELS: Record<VerificationStatus, string> = {
  pending: "Pending review",
  verified: "Verified",
  suspended: "Suspended",
  expired: "Expired",
  rejected: "Rejected",
};

export const SAFETY_NOTICE =
  "Only assist if the area is safe. Do not enter fires, unstable structures, traffic hazards, electrical hazards, chemical hazards or violent situations. Professional emergency responders take priority.";

export function skillLabel(value: string) {
  return VOLUNTEER_SKILLS.find((s) => s.value === value)?.label ?? value;
}

export function skillLabels(values: string[] | null | undefined) {
  return (values ?? []).map(skillLabel);
}

export type VolunteerProfile = {
  id: string;
  user_id: string;
  full_name: string;
  phone: string;
  skills: string[];
  experience: string | null;
  radius_km: number;
  availability: string;
  verification_status: VerificationStatus;
  verification_note: string | null;
  latitude: number | null;
  longitude: number | null;
  location_updated_at: string | null;
  share_location: boolean;
  active: boolean;
  created_at: string;
  updated_at: string;
};

export type VolunteerRequest = {
  match_id: string;
  status: string;
  emergency_type: string | null;
  assistance_required: string[];
  distance_km: number | null;
  approx_area: string;
  offered_at: string;
  exclusive: boolean;
};

export type AcceptedIncident = {
  match_id: string;
  emergency_id: string;
  reference: string;
  status: string;
  phase: string;
  emergency_type: string | null;
  severity: string;
  assistance_required: string[];
  latitude: number | null;
  longitude: number | null;
  address: string | null;
  location_source: string | null;
  notes: string | null;
  victim_name: string;
  responded_at: string | null;
  emergency_status: string;
};

export type EmergencyVolunteer = {
  match_id: string;
  volunteer_name: string;
  volunteer_phone: string | null;
  skills: string[];
  status: string;
  distance_km: number | null;
  responded_at: string | null;
};

/** The signed-in user's own volunteer profile (RLS scopes this to them). */
export const myVolunteerQuery = (userId: string | undefined) =>
  queryOptions({
    queryKey: ["volunteer-profile", userId],
    enabled: Boolean(userId),
    queryFn: async (): Promise<VolunteerProfile | null> => {
      const { data, error } = await supabase
        .from("volunteer_profiles")
        .select("*")
        .eq("user_id", userId!)
        .maybeSingle();
      if (error) throw new Error(error.message);
      return (data as VolunteerProfile) ?? null;
    },
  });

export const verificationHistoryQuery = (volunteerId: string | undefined) =>
  queryOptions({
    queryKey: ["volunteer-verifications", volunteerId],
    enabled: Boolean(volunteerId),
    queryFn: async () => {
      const { data, error } = await supabase
        .from("volunteer_verifications")
        .select("id, status, note, created_at")
        .eq("volunteer_id", volunteerId!)
        .order("created_at", { ascending: false });
      if (error) throw new Error(error.message);
      return data ?? [];
    },
  });

/** Open assistance requests for this volunteer — limited pre-acceptance fields. */
export const volunteerRequestsQuery = (enabled: boolean) =>
  queryOptions({
    queryKey: ["volunteer-requests"],
    enabled,
    refetchInterval: 20_000,
    queryFn: async (): Promise<VolunteerRequest[]> => {
      const { data, error } = await supabase.rpc("volunteer_requests");
      if (error) throw new Error(error.message);
      return (data ?? []) as VolunteerRequest[];
    },
  });

/** Incidents this volunteer has accepted — exact location is authorised now. */
export const acceptedIncidentsQuery = (enabled: boolean) =>
  queryOptions({
    queryKey: ["volunteer-accepted"],
    enabled,
    refetchInterval: 20_000,
    queryFn: async (): Promise<AcceptedIncident[]> => {
      const { data, error } = await supabase.rpc("volunteer_accepted_incidents");
      if (error) throw new Error(error.message);
      return (data ?? []) as AcceptedIncident[];
    },
  });

/** Volunteers attached to one emergency — for the person in trouble and admins. */
export const emergencyVolunteersQuery = (emergencyId: string | undefined) =>
  queryOptions({
    queryKey: ["emergency-volunteers", emergencyId],
    enabled: Boolean(emergencyId),
    refetchInterval: 15_000,
    queryFn: async (): Promise<EmergencyVolunteer[]> => {
      const { data, error } = await supabase.rpc("emergency_volunteers", {
        _emergency_id: emergencyId!,
      });
      if (error) throw new Error(error.message);
      return (data ?? []) as EmergencyVolunteer[];
    },
  });

export type VolunteerInput = {
  fullName: string;
  phone: string;
  skills: string[];
  experience: string;
  radiusKm: number;
  availability: "available" | "offline";
  shareLocation: boolean;
  latitude?: number | null;
  longitude?: number | null;
};

/**
 * Creates or updates the caller's own volunteer profile. `verification_status`
 * is deliberately never sent from here — a database trigger rejects any
 * self-granted verification, so signing up can only ever produce "pending".
 */
export async function saveVolunteerProfile(userId: string, input: VolunteerInput) {
  // Same rules as `public.validate_volunteer_input` — the trigger re-checks
  // everything, so a hand-crafted API call cannot store a bad number.
  const parsed = volunteerSignupSchema.safeParse({
    fullName: input.fullName,
    phone: input.phone,
    skills: input.skills,
    radiusKm: Number(input.radiusKm) || 5,
  });
  if (!parsed.success) throw new Error(firstIssue(parsed.error));

  const name = parsed.data.fullName;
  const phone = parsed.data.phone;
  const radius = Math.min(50, Math.max(1, parsed.data.radiusKm));

  const hasPosition = input.latitude != null && input.longitude != null;
  const payload = {
    user_id: userId,
    full_name: name.slice(0, 80),
    phone,
    skills: parsed.data.skills,
    experience: input.experience.trim().slice(0, 500) || null,

    radius_km: radius,
    availability: input.availability,
    share_location: input.shareLocation,
    ...(hasPosition && input.shareLocation
      ? {
          latitude: input.latitude,
          longitude: input.longitude,
          location_updated_at: new Date().toISOString(),
        }
      : {}),
  };

  const { data, error } = await supabase
    .from("volunteer_profiles")
    .upsert(payload, { onConflict: "user_id" })
    .select("*")
    .single();
  if (error) throw new Error(error.message);
  return data as VolunteerProfile;
}

export async function setVolunteerAvailability(
  profileId: string,
  availability: "available" | "offline",
) {
  const { error } = await supabase
    .from("volunteer_profiles")
    .update({ availability })
    .eq("id", profileId);
  if (error) throw new Error(error.message);
}

/** Refreshes the volunteer's own last-known position (only when they opted in). */
export async function updateVolunteerPosition(
  profileId: string,
  coords: { lat: number; lng: number },
) {
  const { error } = await supabase
    .from("volunteer_profiles")
    .update({
      latitude: coords.lat,
      longitude: coords.lng,
      location_updated_at: new Date().toISOString(),
    })
    .eq("id", profileId);
  if (error) throw new Error(error.message);
}

/** Asks the server to find real nearby verified volunteers for this emergency. */
export async function requestVolunteerAssistance(
  emergencyId: string,
  assistance: string[],
  radiusKm?: number,
) {
  const { data, error } = await supabase.rpc("request_volunteer_assistance", {
    _emergency_id: emergencyId,
    _assistance: assistance,
    _radius_km: radiusKm ?? undefined,
    _exclusive: true,
  });
  if (error) throw new Error(error.message);
  return (data ?? { offered: 0 }) as unknown as { offered: number; reason?: string };
}

/** Atomic accept/decline. Only one volunteer can claim an exclusive request. */
export async function respondToRequest(matchId: string, accept: boolean) {
  const { data, error } = await supabase.rpc("volunteer_respond", {
    _match_id: matchId,
    _accept: accept,
  });
  if (error) throw new Error(error.message);
  return (data ?? { claimed: false, status: "unknown" }) as unknown as {
    claimed: boolean;
    status: string;
    reason?: string;
  };
}

export async function completeAssistance(matchId: string, note?: string) {
  const { error } = await supabase.rpc("volunteer_complete", {
    _match_id: matchId,
    _note: note ?? undefined,
  });
  if (error) throw new Error(error.message);
}

export function navigationLink(latitude: number | null, longitude: number | null) {
  if (latitude == null || longitude == null) return null;
  return `https://www.google.com/maps/dir/?api=1&destination=${latitude},${longitude}`;
}

export function minutesAgo(iso: string | null | undefined) {
  if (!iso) return null;
  return Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 60_000));
}
