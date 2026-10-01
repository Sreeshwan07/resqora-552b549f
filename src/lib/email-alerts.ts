import { coordsOf, mapsLink } from "@/lib/alerts";
import type { Emergency, EmergencyContact, Profile } from "@/lib/api";
import { isValidEmail } from "@/lib/email-service";
import { requestEmergencyEmails } from "@/lib/emergency-email.functions";

/** Full emergency email body defined by the RESQORA communication protocol. */
export function buildEmergencyEmail(input: {
  emergency: Emergency;
  profile: Profile | null | undefined;
  address?: string | null;
  trackingUrl?: string | null;
  status?: string;
}) {
  const { emergency, profile, trackingUrl } = input;
  const coords = coordsOf(emergency);
  const name = profile?.full_name || "An RESQORA user";
  const address =
    input.address || emergency.address || profile?.home_address || "Address unavailable";
  const subject = `🚨 RESQORA Emergency Alert — ${name}`;
  const shareMedical = profile?.share_medical_in_alerts !== false;
  const medical = shareMedical
    ? [
        profile?.blood_group ? `Blood group: ${profile.blood_group}` : null,
        profile?.allergies ? `Allergies: ${profile.allergies}` : null,
        profile?.medical_conditions ? `Conditions: ${profile.medical_conditions}` : null,
        profile?.medications ? `Medications: ${profile.medications}` : null,
      ].filter(Boolean)
    : [];
  const message = [
    "🚨 RESQORA Emergency Alert",
    "",
    `${name} has triggered an Emergency SOS and may need immediate assistance.`,
    "",
    `User Name: ${name}`,
    `Emergency Type: ${emergency.type.replace(/_/g, " ")}`,
    `Current Status: ${(input.status ?? emergency.status).replace(/_/g, " ")}`,
    `Their Phone Number: ${profile?.phone || "Not provided"}`,
    `Emergency Started: ${new Date(emergency.started_at).toLocaleString()}`,
    `Current Address: ${address}`,
    `Latitude: ${coords ? coords.lat.toFixed(6) : "Awaiting GPS"}`,
    `Longitude: ${coords ? coords.lng.toFixed(6) : "Awaiting GPS"}`,
    `Google Maps: ${coords ? mapsLink(coords) : "Pending location capture"}`,
    `Live Tracking Link: ${trackingUrl || "Not available"}`,
    `Emergency Time: ${new Date().toLocaleString()}`,
    `Emergency ID: ${emergency.id.slice(0, 8).toUpperCase()}`,
    ...(medical.length > 0 ? ["", "Medical information:", ...medical] : []),
    "",
    trackingUrl ? `▶ OPEN LIVE TRACKING: ${trackingUrl}` : "",
    "",
    "Please call them now or contact local emergency services.",
  ].join("\n");
  return { subject, message };
}

export function buildResolvedEmail(input: {
  emergency: Emergency;
  profile: Profile | null | undefined;
}) {
  const name = input.profile?.full_name || "An RESQORA user";
  return {
    subject: `✅ RESQORA Emergency Resolved — ${name}`,
    message: [
      "✅ RESQORA Emergency Resolved",
      "",
      `${name} has confirmed they are safe.`,
      "",
      `Emergency ID: ${input.emergency.id.slice(0, 8).toUpperCase()}`,
      `Resolved at: ${new Date().toLocaleString()}`,
      "",
      "Live location sharing has been stopped.",
    ].join("\n"),
  };
}

/**
 * Contacts that can actually receive an email: a valid address, and one row per
 * address so the same person never receives the same alert twice.
 */
export function contactsWithEmail(contacts: EmergencyContact[]) {
  const seen = new Set<string>();
  return contacts.filter((contact) => {
    if (!isValidEmail(contact.email)) return false;
    const key = contact.email!.trim().toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export type EmailDeliveryOutcome = { name: string; ok: boolean; error?: string };

/**
 * Asks the server to email this emergency's saved contacts. The browser never
 * supplies recipient addresses and never talks to an email provider.
 */
export async function sendEmergencyEmailAlerts(input: {
  userId: string;
  emergency: Emergency;
  profile?: Profile | null | undefined;
  contacts: EmergencyContact[];
  address?: string | null;
  trackingUrl?: string | null;
  kind?: "alert" | "resolved";
}) {
  if (contactsWithEmail(input.contacts).length === 0) {
    return {
      sent: 0,
      failed: 0,
      configured: true,
      skipped: true,
      results: [] as EmailDeliveryOutcome[],
    };
  }
  const r = await requestEmergencyEmails({
    data: {
      emergencyId: input.emergency.id,
      kind: input.kind ?? "alert",
      trackingUrl: input.trackingUrl ?? undefined,
    },
  });
  if (r.error) throw new Error(r.error);
  return {
    sent: r.sent,
    failed: r.failed,
    configured: r.configured,
    skipped: r.skipped,
    results: r.results
      .filter((x) => x.status !== "duplicate")
      .map((x) => ({ name: x.name, ok: x.status === "sent", error: x.error })),
  };
}
