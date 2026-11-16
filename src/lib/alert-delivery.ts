import { queryOptions } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import type { Database } from "@/integrations/supabase/types";
import type { Emergency, EmergencyContact, Profile } from "@/lib/api";
import { coordsOf, mapsLink } from "@/lib/alerts";

export type AlertDelivery = Database["public"]["Tables"]["emergency_alert_deliveries"]["Row"];

export const deliveriesQuery = (emergencyId: string | undefined) =>
  queryOptions({
    queryKey: ["alert-deliveries", emergencyId],
    enabled: Boolean(emergencyId),
    refetchInterval: 15000,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("emergency_alert_deliveries")
        .select("*")
        .eq("emergency_id", emergencyId!)
        .order("created_at", { ascending: true });
      if (error) throw new Error(error.message);
      return data as AlertDelivery[];
    },
  });

/** Exact alert body defined by the RESQORA emergency protocol. */
export function buildEmergencyAlert(input: {
  emergency: Emergency;
  profile: Profile | null | undefined;
  address?: string | null;
  trackingUrl?: string | null;
}) {
  const { emergency, profile, trackingUrl } = input;
  const coords = coordsOf(emergency);
  const address =
    input.address || emergency.address || profile?.home_address || "Address unavailable";
  return [
    "🚨 RESQORA Emergency Alert",
    "",
    `${profile?.full_name || "An RESQORA user"} may need immediate assistance.`,
    "",
    "Current Address:",
    address,
    "",
    "Live Location:",
    trackingUrl || (coords ? mapsLink(coords) : "Awaiting GPS fix"),
    "",
    "Time:",
    new Date(emergency.started_at).toLocaleString(),
    "",
    "Emergency ID:",
    emergency.id.slice(0, 8).toUpperCase(),
    "",
    "Status:",
    "Emergency Active",
  ].join("\n");
}

export function buildResolvedAlert(input: {
  emergency: Emergency;
  profile: Profile | null | undefined;
}) {
  const { emergency, profile } = input;
  return [
    "✅ RESQORA Emergency Resolved",
    "",
    `${profile?.full_name || "An RESQORA user"} has confirmed they are safe.`,
    "",
    "Emergency ID:",
    emergency.id.slice(0, 8).toUpperCase(),
    "",
    "Resolved at:",
    new Date().toLocaleString(),
    "",
    "Live location sharing has been stopped.",
  ].join("\n");
}

/**
 * Creates one pending delivery row per trusted contact. Duplicates are ignored
 * by the database uniqueness rule, so re-running this never doubles a row.
 */
export async function seedDeliveries(input: {
  userId: string;
  emergencyId: string;
  contacts: EmergencyContact[];
  kind?: "alert" | "resolved";
}) {
  if (input.contacts.length === 0) return [];
  const kind = input.kind ?? "alert";
  const rows = input.contacts.map((contact) => ({
    user_id: input.userId,
    emergency_id: input.emergencyId,
    contact_id: contact.id,
    contact_name: contact.name,
    contact_phone: contact.phone,
    channel: "sms",
    status: "pending",
    kind,
  }));
  const { error } = await supabase
    .from("emergency_alert_deliveries")
    .upsert(rows, { onConflict: "emergency_id,kind,channel,contact_id", ignoreDuplicates: true });
  if (error) throw new Error(error.message);
  const { data, error: readError } = await supabase
    .from("emergency_alert_deliveries")
    .select("*")
    .eq("emergency_id", input.emergencyId)
    .eq("kind", kind)
    .eq("channel", "sms");
  if (readError) throw new Error(readError.message);
  return data as AlertDelivery[];
}

export async function markDelivery(
  id: string,
  status: "delivered" | "failed" | "pending",
  options: { channel?: string; error?: string | null } = {},
) {
  const { error } = await supabase
    .from("emergency_alert_deliveries")
    .update({
      status,
      channel: options.channel,
      error: options.error ?? null,
      sent_at: status === "delivered" ? new Date().toISOString() : null,
    })
    .eq("id", id);
  if (error) throw new Error(error.message);
}

/**
 * Asks the server to send the emergency SMS. The server owns ownership checks,
 * recipient selection, the message body, rate limiting and idempotency — the
 * client only names its own emergency. Returns false when no SMS provider is
 * connected so the UI can offer WhatsApp / SMS / email hand-off instead.
 */
export async function dispatchDeliveries(input: {
  emergencyId: string;
  kind?: "alert" | "resolved";
  contactIds?: string[];
  trackingUrl?: string | null;
  address?: string | null;
}) {
  const { sendEmergencyAlerts } = await import("@/lib/alerts.functions");
  const response = await sendEmergencyAlerts({
    data: {
      emergencyId: input.emergencyId,
      kind: input.kind ?? "alert",
      ...(input.contactIds?.length ? { contactIds: input.contactIds } : {}),
      ...(input.trackingUrl ? { trackingUrl: input.trackingUrl } : {}),
      ...(input.address ? { address: input.address } : {}),
    },
  });
  return response;
}
