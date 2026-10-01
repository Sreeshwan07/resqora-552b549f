import { queryOptions } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import type { Database } from "@/integrations/supabase/types";
import type { Emergency, EmergencyContact, Profile } from "@/lib/api";
import { coordsOf, mapsLink } from "@/lib/alerts";
import { origin, randomToken } from "@/lib/share";

export type GuardianSession = Database["public"]["Tables"]["guardian_sessions"]["Row"];

/** The Guardian link stays readable for a short grace period after resolution. */
const GRACE_MINUTES = 30;

export function guardianOf(contacts: EmergencyContact[] | undefined) {
  return contacts?.find((contact) => contact.is_guardian) ?? null;
}

export function guardianUrl(session: Pick<GuardianSession, "emergency_id" | "token">) {
  return `${origin()}/guardian/${session.emergency_id}/${session.token}`;
}

/** Promotes one trusted contact to Guardian; only one can be active at a time. */
export async function setGuardian(userId: string, contactId: string | null) {
  const clear = await supabase
    .from("emergency_contacts")
    .update({ is_guardian: false })
    .eq("user_id", userId)
    .eq("is_guardian", true);
  if (clear.error) throw new Error(clear.error.message);
  if (!contactId) return;
  const { error } = await supabase
    .from("emergency_contacts")
    .update({ is_guardian: true })
    .eq("id", contactId)
    .eq("user_id", userId);
  if (error) throw new Error(error.message);
}

/** Secure Guardian session for one emergency, created on demand. */
export async function ensureGuardianSession(input: {
  userId: string;
  emergencyId: string;
  guardian: Pick<EmergencyContact, "id" | "name" | "email" | "phone"> | null;
}) {
  const existing = await supabase
    .from("guardian_sessions")
    .select("*")
    .eq("emergency_id", input.emergencyId)
    .eq("active", true)
    .maybeSingle();
  if (existing.error) throw new Error(existing.error.message);
  if (existing.data) return existing.data as GuardianSession;

  const { data, error } = await supabase
    .from("guardian_sessions")
    .insert({
      user_id: input.userId,
      emergency_id: input.emergencyId,
      guardian_contact_id: input.guardian?.id ?? null,
      guardian_name: input.guardian?.name ?? "Trusted contact",
      guardian_email: input.guardian?.email ?? null,
      guardian_phone: input.guardian?.phone ?? null,
      token: randomToken(24),
    })
    .select("*")
    .single();
  if (error) throw new Error(error.message);
  return data as GuardianSession;
}

/**
 * The single secure live-tracking URL for an emergency. Every SOS gets one
 * Guardian session, so every alert (email, WhatsApp, share centre) points at the
 * same Guardian dashboard instead of a plain tracking page.
 */
export async function ensureTrackingUrl(input: {
  userId: string;
  emergencyId: string;
  guardian?: EmergencyContact | null;
}) {
  const session = await ensureGuardianSession({
    userId: input.userId,
    emergencyId: input.emergencyId,
    guardian: input.guardian ?? null,
  });
  return { session, url: guardianUrl(session) };
}

/** Called when the emergency ends — the link expires after a short grace period. */
export async function expireGuardianSessions(emergencyId: string) {
  const expiresAt = new Date(Date.now() + GRACE_MINUTES * 60_000).toISOString();
  const { error } = await supabase
    .from("guardian_sessions")
    .update({ expires_at: expiresAt })
    .eq("emergency_id", emergencyId)
    .eq("active", true);
  if (error) throw new Error(error.message);
}

export const guardianSessionQuery = (emergencyId: string | undefined) =>
  queryOptions({
    queryKey: ["guardian-session", emergencyId],
    enabled: Boolean(emergencyId),
    queryFn: async () => {
      const { data, error } = await supabase
        .from("guardian_sessions")
        .select("*")
        .eq("emergency_id", emergencyId!)
        .eq("active", true)
        .maybeSingle();
      if (error) throw new Error(error.message);
      return (data ?? null) as GuardianSession | null;
    },
  });

/** The Guardian email defined by the RESQORA Guardian protocol. */
export function buildGuardianEmail(input: {
  emergency: Emergency;
  profile: Profile | null | undefined;
  guardian: EmergencyContact;
  address?: string | null;
  trackingUrl?: string | null;
  dashboardUrl: string;
}) {
  const { emergency, profile, guardian, dashboardUrl } = input;
  const coords = coordsOf(emergency);
  const name = profile?.full_name || "An RESQORA user";
  const address =
    input.address || emergency.address || profile?.home_address || "Address unavailable";
  return {
    subject: `🚨 RESQORA Emergency Alert — ${name} needs you (Guardian)`,
    message: [
      "🚨 RESQORA Emergency Alert",
      "",
      `${guardian.name}, you are the Guardian for ${name}.`,
      `${name} has activated Emergency SOS.`,
      "",
      `Current Address: ${address}`,
      `Live GPS Location: ${coords ? `${coords.lat.toFixed(6)}, ${coords.lng.toFixed(6)}` : "Awaiting GPS"}`,
      `Google Maps Link: ${coords ? mapsLink(coords) : "Pending location capture"}`,
      `Secure Live Tracking Link: ${input.trackingUrl || "Not available"}`,
      `Emergency Time: ${new Date(emergency.started_at).toLocaleString()}`,
      `Emergency ID: ${emergency.id.slice(0, 8).toUpperCase()}`,
      `Current Emergency Status: ${emergency.status.replace(/_/g, " ")}`,
      "",
      "Open Guardian Dashboard:",
      dashboardUrl,
      "",
      "The dashboard shows live location, movement trail, nearest emergency services and a live timeline. It expires automatically once the emergency ends.",
    ].join("\n"),
  };
}

/**
 * Creates the Guardian session and emails the Guardian. Returns the session so
 * the app can show the link and its delivery status.
 */
export async function notifyGuardian(input: {
  userId: string;
  emergency: Emergency;
  profile: Profile | null | undefined;
  guardian: EmergencyContact;
  address?: string | null;
  trackingUrl?: string | null;
}) {
  const session = await ensureGuardianSession({
    userId: input.userId,
    emergencyId: input.emergency.id,
    guardian: input.guardian,
  });
  const dashboardUrl = guardianUrl(session);
  // Relay chain: the acknowledgement window opens the moment the Guardian is told.
  const { markRelayNotified } = await import("@/lib/relay");
  await markRelayNotified(input.emergency.id).catch(() => undefined);
  const { pushEmergencyAlert } = await import("@/lib/emergency-notifications");
  void pushEmergencyAlert({
    kind: "guardian",
    emergencyId: input.emergency.id,
    personName: input.profile?.full_name,
    guardianUrl: dashboardUrl,
  });
  if (!input.guardian.email?.includes("@")) {
    return { session, dashboardUrl, configured: true, emailed: false };
  }

  // The server resolves the Guardian from the user's saved contacts.
  const { requestEmergencyEmails } = await import("@/lib/emergency-email.functions");
  const r = await requestEmergencyEmails({
    data: {
      emergencyId: input.emergency.id,
      kind: "guardian",
      contactIds: [input.guardian.id],
      trackingUrl: dashboardUrl,
    },
  });
  const emailed = r.sent > 0;
  return {
    session,
    dashboardUrl,
    configured: r.configured,
    emailed,
    error: emailed ? undefined : (r.error ?? r.results[0]?.error ?? "Email notification could not be sent."),
  };
}
