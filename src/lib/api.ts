import { queryOptions } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import type { Database } from "@/integrations/supabase/types";

export type Profile = Database["public"]["Tables"]["profiles"]["Row"];
export type EmergencyContact = Database["public"]["Tables"]["emergency_contacts"]["Row"];
/**
 * Emergencies raised inside the app always belong to a signed-in account. The
 * column itself is nullable because an SMS from an unregistered phone can also
 * open a real emergency; those are handled server-side and by operators, never
 * through these account-scoped queries.
 */
export type EmergencyRow = Database["public"]["Tables"]["emergencies"]["Row"];
export type Emergency = Omit<EmergencyRow, "user_id"> & { user_id: string };
export type EmergencyEvent = Database["public"]["Tables"]["emergency_events"]["Row"];
export type AppNotification = Database["public"]["Tables"]["notifications"]["Row"];

function unwrap<T>({ data, error }: { data: T | null; error: { message: string } | null }): T {
  if (error) throw new Error(error.message);
  return data as T;
}

export const profileQuery = (userId: string | undefined) =>
  queryOptions({
    queryKey: ["profile", userId],
    enabled: Boolean(userId),
    queryFn: async () =>
      unwrap(
        await supabase.from("profiles").select("*").eq("id", userId!).maybeSingle(),
      ) as Profile | null,
  });

export const contactsQuery = (userId: string | undefined) =>
  queryOptions({
    queryKey: ["contacts", userId],
    enabled: Boolean(userId),
    queryFn: async () =>
      unwrap(
        await supabase
          .from("emergency_contacts")
          .select("*")
          .eq("user_id", userId!)
          .order("position", { ascending: true }),
      ) as EmergencyContact[],
  });

export const emergenciesQuery = (userId: string | undefined) =>
  queryOptions({
    queryKey: ["emergencies", userId],
    enabled: Boolean(userId),
    queryFn: async () =>
      unwrap(
        await supabase
          .from("emergencies")
          .select("*")
          .eq("user_id", userId!)
          .order("started_at", { ascending: false }),
      ) as Emergency[],
  });

export const activeEmergencyQuery = (userId: string | undefined) =>
  queryOptions({
    queryKey: ["active-emergency", userId],
    enabled: Boolean(userId),
    refetchInterval: 15000,
    queryFn: async () =>
      unwrap(
        await supabase
          .from("emergencies")
          .select("*")
          .eq("user_id", userId!)
          .neq("status", "resolved")
          .neq("status", "cancelled")
          .order("started_at", { ascending: false })
          .limit(1)
          .maybeSingle(),
      ) as Emergency | null,
  });

export const emergencyEventsQuery = (emergencyId: string | undefined) =>
  queryOptions({
    queryKey: ["emergency-events", emergencyId],
    enabled: Boolean(emergencyId),
    queryFn: async () =>
      unwrap(
        await supabase
          .from("emergency_events")
          .select("*")
          .eq("emergency_id", emergencyId!)
          .order("created_at", { ascending: true }),
      ) as EmergencyEvent[],
  });

export const notificationsQuery = (userId: string | undefined) =>
  queryOptions({
    queryKey: ["notifications", userId],
    enabled: Boolean(userId),
    queryFn: async () =>
      unwrap(
        await supabase
          .from("notifications")
          .select("*")
          .eq("user_id", userId!)
          .order("created_at", { ascending: false })
          .limit(50),
      ) as AppNotification[],
  });

export const isAdminQuery = (userId: string | undefined) =>
  queryOptions({
    queryKey: ["is-admin", userId],
    enabled: Boolean(userId),
    queryFn: async () => {
      const { data, error } = await supabase
        .from("user_roles")
        .select("role")
        .eq("user_id", userId!)
        .eq("role", "admin")
        .maybeSingle();
      if (error) throw new Error(error.message);
      return Boolean(data);
    },
  });

export const adminOverviewQuery = () =>
  queryOptions({
    queryKey: ["admin-overview"],
    queryFn: async () => {
      const [profiles, emergencies] = await Promise.all([
        supabase
          .from("profiles")
          .select("id, current_city, onboarding_completed, safety_score, created_at"),
        supabase
          .from("emergencies")
          .select(
            "id, type, severity, status, latitude, longitude, started_at, resolved_at, duration_seconds",
          ),
      ]);
      if (profiles.error) throw new Error(profiles.error.message);
      if (emergencies.error) throw new Error(emergencies.error.message);
      return { profiles: profiles.data, emergencies: emergencies.data };
    },
  });

export async function notify(
  userId: string,
  input: { title: string; body?: string; category?: string },
) {
  await supabase.from("notifications").insert({
    user_id: userId,
    title: input.title,
    body: input.body ?? null,
    category: input.category ?? "system",
  });
}

export async function logEvent(
  emergencyId: string,
  userId: string,
  label: string,
  detail?: string,
) {
  await supabase
    .from("emergency_events")
    .insert({ emergency_id: emergencyId, user_id: userId, label, detail: detail ?? null });
}

export function computeSafetyScore(profile: Profile | null, contacts: EmergencyContact[]): number {
  if (!profile) return 0;
  let score = 20;
  const fields: (keyof Profile)[] = [
    "full_name",
    "phone",
    "date_of_birth",
    "blood_group",
    "home_address",
    "current_city",
  ];
  for (const field of fields) if (profile[field]) score += 7;
  if (profile.allergies || profile.medical_conditions || profile.medications) score += 8;
  score += Math.min(contacts.length, 3) * 10;
  return Math.min(100, score);
}

export function scoreTone(score: number) {
  if (score >= 80) return { label: "Excellent", status: "safe" as const };
  if (score >= 55) return { label: "Good", status: "active" as const };
  if (score >= 35) return { label: "Needs work", status: "warning" as const };
  return { label: "At risk", status: "critical" as const };
}

export function getCurrentPosition(): Promise<GeolocationPosition> {
  return new Promise((resolve, reject) => {
    if (typeof navigator === "undefined" || !navigator.geolocation) {
      reject(new Error("Geolocation is not supported on this device"));
      return;
    }
    navigator.geolocation.getCurrentPosition(resolve, reject, {
      enableHighAccuracy: true,
      timeout: 10000,
      maximumAge: 0,
    });
  });
}
