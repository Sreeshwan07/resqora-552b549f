import { supabase } from "@/integrations/supabase/client";
import { sendEmergencyTemplateEmail } from "@/lib/email-service";
import { buildEmergencyEmailHtml } from "@/lib/email-alerts";
import { origin } from "@/lib/share";

/**
 * Bystander Mode.
 *
 * A passer-by who scans a RESQR ID can raise the emergency on the victim's
 * behalf without an account. Every write goes through one SECURITY DEFINER
 * function, so an anonymous visitor never touches a table directly and only
 * ever gets back the minimum needed to help.
 */
export type BystanderActivation = {
  emergency_id: string;
  reference: string;
  already_active: boolean;
  victim_name: string;
  guardian_name: string | null;
  guardian_email: string | null;
  guardian_phone: string | null;
  guardian_token: string;
  started_at: string;
};

export type BystanderResult = {
  activation: BystanderActivation;
  guardianUrl: string;
  /** Only true when EmailJS actually accepted the guardian alert. */
  guardianEmailSent: boolean;
  guardianEmailError: string | null;
};

/** One low-friction position attempt; the emergency must never wait on GPS. */
export function bystanderPosition(timeout = 8000) {
  return new Promise<GeolocationPosition | null>((resolve) => {
    if (typeof navigator === "undefined" || !navigator.geolocation) return resolve(null);
    let settled = false;
    const done = (value: GeolocationPosition | null) => {
      if (settled) return;
      settled = true;
      resolve(value);
    };
    navigator.geolocation.getCurrentPosition(
      (pos) => done(pos),
      () => done(null),
      { enableHighAccuracy: true, timeout, maximumAge: 30_000 },
    );
    window.setTimeout(() => done(null), timeout + 500);
  });
}

export function guardianLinkFor(emergencyId: string, token: string) {
  return `${origin()}/guardian/${emergencyId}/${token}`;
}

/**
 * Activates the emergency, then attempts the guardian email. The email is a
 * best-effort second step: a failure there never invalidates the emergency.
 */
export async function activateBystanderEmergency(input: {
  code: string;
  note?: string | null;
  position?: GeolocationPosition | null;
}): Promise<BystanderResult> {
  const coords = input.position?.coords;
  const { data, error } = await supabase.rpc("bystander_activate_emergency", {
    _code: input.code,
    _latitude: coords?.latitude ?? undefined,
    _longitude: coords?.longitude ?? undefined,
    _accuracy: coords?.accuracy ?? undefined,
    _note: input.note?.trim() ? input.note.trim() : undefined,
  });
  if (error) throw new Error(error.message);
  const activation = data as unknown as BystanderActivation | null;
  if (!activation) throw new Error("Could not activate the emergency. Please call 108.");

  const guardianUrl = guardianLinkFor(activation.emergency_id, activation.guardian_token);
  let guardianEmailSent = false;
  let guardianEmailError: string | null = null;

  if (activation.guardian_email) {
    const time = new Date().toLocaleString();
    const address = coords
      ? `${coords.latitude.toFixed(5)}, ${coords.longitude.toFixed(5)}`
      : "Location unavailable";
    const mapLink = coords
      ? `https://www.google.com/maps/search/?api=1&query=${coords.latitude},${coords.longitude}`
      : "Pending location capture";
    const status = "🔴 Emergency raised by a bystander";
    const result = await sendEmergencyTemplateEmail({
      to_email: activation.guardian_email,
      user_name: activation.victim_name,
      time,
      address,
      map_link: mapLink,
      tracking_link: guardianUrl,
      emergency_id: activation.reference,
      reply_to: "no-reply@resqora.app",
      status,
      support_contact: activation.guardian_phone ?? "Emergency services: 108",
      message_html: buildEmergencyEmailHtml({
        name: activation.victim_name,
        time,
        address,
        mapLink,
        trackingUrl: guardianUrl,
        reference: activation.reference,
        status,
        supportContact: activation.guardian_phone ?? "Emergency services: 108",
      }),
    });
    guardianEmailSent = result.ok;
    guardianEmailError = result.ok ? null : (result.error ?? "Email could not be sent");
  }

  return { activation, guardianUrl, guardianEmailSent, guardianEmailError };
}
