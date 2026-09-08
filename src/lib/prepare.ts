/**
 * Before-the-disaster layer: personal preparedness checklist and the live
 * disaster advisory zones. Both are real records, not static copy — the
 * checklist is per person and private, the zones are published by
 * administrators and readable by anyone (including the public advisory view).
 */
import { queryOptions } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

export const ZONE_TYPES = [
  { value: "flood", label: "Flood" },
  { value: "fire", label: "Fire" },
  { value: "earthquake", label: "Earthquake" },
  { value: "cyclone", label: "Cyclone / storm" },
  { value: "landslide", label: "Landslide" },
  { value: "chemical", label: "Chemical / industrial" },
  { value: "other", label: "Other hazard" },
] as const;

export const ZONE_SEVERITIES = [
  { value: "advisory", label: "Advisory" },
  { value: "moderate", label: "Moderate" },
  { value: "severe", label: "Severe" },
  { value: "critical", label: "Critical" },
] as const;

export type DisasterZone = {
  id: string;
  name: string;
  zone_type: string;
  severity: string;
  advisory: string | null;
  latitude: number;
  longitude: number;
  radius_km: number;
  active: boolean;
  is_simulation: boolean;
  starts_at: string;
  ends_at: string | null;
};

export type PreparednessTask = {
  id: string;
  task_key: string;
  label: string;
  category: string;
  done: boolean;
  completed_at: string | null;
};

export function zoneTypeLabel(value: string) {
  return ZONE_TYPES.find((entry) => entry.value === value)?.label ?? value;
}

export function zoneSeverityLabel(value: string) {
  return ZONE_SEVERITIES.find((entry) => entry.value === value)?.label ?? value;
}

/** The starter plan. Seeded into the user's own list the first time they open Prepare. */
export const PREPAREDNESS_PLAN: { key: string; label: string; category: string }[] = [
  { key: "contacts", label: "Add at least two emergency contacts", category: "People" },
  { key: "guardian", label: "Choose a Guardian who gets the live link", category: "People" },
  { key: "medical", label: "Complete blood group, allergies and medication", category: "Medical" },
  { key: "resqr", label: "Print or save your RESQR ID card", category: "Medical" },
  { key: "meeting_point", label: "Agree a family meeting point", category: "Household plan" },
  { key: "escape_route", label: "Know two ways out of your home", category: "Household plan" },
  { key: "documents", label: "Keep ID and insurance copies offline", category: "Household plan" },
  { key: "go_bag", label: "Pack a go-bag: water, torch, power bank, cash", category: "Go-bag" },
  { key: "first_aid", label: "Stock a first-aid kit and check the dates", category: "Go-bag" },
  { key: "medicines", label: "Keep three days of essential medicines", category: "Go-bag" },
  { key: "install", label: "Install RESQORA on your phone for offline use", category: "Readiness" },
  { key: "location", label: "Allow location so help can find you", category: "Readiness" },
  { key: "notifications", label: "Turn on emergency notifications", category: "Readiness" },
  { key: "drill", label: "Run one practice drill with your household", category: "Readiness" },
];

export const preparednessQuery = (userId: string | undefined) =>
  queryOptions({
    queryKey: ["preparedness-tasks", userId],
    enabled: Boolean(userId),
    queryFn: async (): Promise<PreparednessTask[]> => {
      const { data, error } = await supabase
        .from("preparedness_tasks")
        .select("id, task_key, label, category, done, completed_at")
        .eq("user_id", userId!)
        .order("created_at", { ascending: true });
      if (error) throw new Error(error.message);
      return (data ?? []) as PreparednessTask[];
    },
  });

/** Adds any plan items the user does not have yet. Safe to call repeatedly. */
export async function ensurePreparednessPlan(userId: string, existing: PreparednessTask[]) {
  const have = new Set(existing.map((task) => task.task_key));
  const missing = PREPAREDNESS_PLAN.filter((item) => !have.has(item.key));
  if (missing.length === 0) return false;
  const { error } = await supabase.from("preparedness_tasks").upsert(
    missing.map((item) => ({
      user_id: userId,
      task_key: item.key,
      label: item.label,
      category: item.category,
    })),
    { onConflict: "user_id,task_key" },
  );
  if (error) throw new Error(error.message);
  return true;
}

export async function setPreparednessDone(id: string, done: boolean) {
  const { error } = await supabase
    .from("preparedness_tasks")
    .update({ done, completed_at: done ? new Date().toISOString() : null })
    .eq("id", id);
  if (error) throw new Error(error.message);
}

export const zonesQuery = () =>
  queryOptions({
    queryKey: ["disaster-zones"],
    staleTime: 30_000,
    queryFn: async (): Promise<DisasterZone[]> => {
      const { data, error } = await supabase
        .from("disaster_zones")
        .select(
          "id, name, zone_type, severity, advisory, latitude, longitude, radius_km, active, is_simulation, starts_at, ends_at",
        )
        .eq("active", true)
        .order("severity", { ascending: false })
        .order("starts_at", { ascending: false });
      if (error) throw new Error(error.message);
      return (data ?? []) as DisasterZone[];
    },
  });

/** Straight-line distance in kilometres. */
export function distanceKm(
  from: { latitude: number; longitude: number },
  to: { latitude: number; longitude: number },
) {
  const radius = 6371;
  const dLat = ((to.latitude - from.latitude) * Math.PI) / 180;
  const dLon = ((to.longitude - from.longitude) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((from.latitude * Math.PI) / 180) *
      Math.cos((to.latitude * Math.PI) / 180) *
      Math.sin(dLon / 2) ** 2;
  return radius * 2 * Math.asin(Math.min(1, Math.sqrt(a)));
}

/** Zones whose circle currently contains the given position. */
export function zonesAround(
  zones: DisasterZone[],
  position: { latitude: number; longitude: number } | null,
) {
  if (!position) return [];
  return zones
    .map((zone) => ({ zone, km: distanceKm(position, zone) }))
    .filter((entry) => entry.km <= entry.zone.radius_km)
    .sort((a, b) => a.km - b.km);
}
