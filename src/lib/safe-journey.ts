/**
 * SAFE JOURNEY — everyday travel monitoring.
 *
 * Built entirely on the existing RESQORA foundations: the signed-in account,
 * the emergency-contact list (guardians), the shared live-location hook, the
 * `notifications` table, the EmailJS transport and the emergency session.
 * Nothing here simulates a journey, a location or a delivery: every state
 * change is a server-validated database transition, every location is a real
 * device fix, and a notification is only recorded as sent when the channel
 * actually accepted it.
 */
import { queryOptions } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import type { Database } from "@/integrations/supabase/types";
import type { EmergencyContact, Profile } from "@/lib/api";
import { haversineKm } from "@/lib/geo";
import { mapsLink } from "@/lib/alerts";
import { logActivity } from "@/lib/activity";
import { isEmailConfigured, sendEmergencyTemplateEmail } from "@/lib/email-service";
import { whatsappShareLink } from "@/lib/whatsapp-alerts";

export type SafeJourney = Database["public"]["Tables"]["safe_journeys"]["Row"];
export type SafeJourneyEvent = Database["public"]["Tables"]["safe_journey_events"]["Row"];
export type SafeJourneyNotification =
  Database["public"]["Tables"]["safe_journey_notifications"]["Row"];
export type SafetyCircleMember = Database["public"]["Tables"]["safety_circle_members"]["Row"];

export type JourneyStatus =
  | "planned"
  | "active"
  | "arriving"
  | "check_in_required"
  | "check_in_missed"
  | "guardian_notified"
  | "emergency_escalated"
  | "completed"
  | "cancelled";

export const LIVE_JOURNEY_STATUSES: JourneyStatus[] = [
  "planned",
  "active",
  "arriving",
  "check_in_required",
  "check_in_missed",
  "guardian_notified",
  "emergency_escalated",
];

/**
 * Status presentation. `tone` drives colour, but every status also carries a
 * label and an icon-independent description so status is never colour-only.
 */
export const JOURNEY_STATUS_META: Record<
  JourneyStatus,
  { label: string; tone: "safe" | "active" | "warning" | "critical" | "muted"; detail: string }
> = {
  planned: { label: "Planned", tone: "muted", detail: "Not started yet." },
  active: { label: "On journey", tone: "active", detail: "Monitoring your journey." },
  arriving: { label: "Arriving", tone: "active", detail: "You appear to be near the destination." },
  check_in_required: {
    label: "Check-in required",
    tone: "warning",
    detail: "Confirm you are safe.",
  },
  check_in_missed: {
    label: "Check-in missed",
    tone: "critical",
    detail: "No confirmation has been received.",
  },
  guardian_notified: {
    label: "Guardian notified",
    tone: "critical",
    detail: "Your guardian has been told no confirmation was received.",
  },
  emergency_escalated: {
    label: "Emergency session open",
    tone: "critical",
    detail: "The emergency session is now the source of truth.",
  },
  completed: { label: "Completed", tone: "safe", detail: "Journey marked safe." },
  cancelled: { label: "Cancelled", tone: "muted", detail: "Journey cancelled." },
};

export const GRACE_PERIOD_OPTIONS = [5, 10, 15, 30] as const;
export const CHECK_IN_INTERVAL_OPTIONS = [
  { value: "", label: "Arrival confirmation only" },
  { value: "15", label: "Every 15 minutes" },
  { value: "30", label: "Every 30 minutes" },
  { value: "60", label: "Every hour" },
] as const;

/** Distance within which we ask (never assume) whether the user has arrived. */
export const ARRIVAL_RADIUS_KM = 0.25;

export function isLive(journey: SafeJourney | null | undefined) {
  return Boolean(journey && LIVE_JOURNEY_STATUSES.includes(journey.status as JourneyStatus));
}

export function statusMeta(status: string) {
  return (
    JOURNEY_STATUS_META[status as JourneyStatus] ?? {
      label: status.replace(/_/g, " "),
      tone: "muted" as const,
      detail: "",
    }
  );
}

/* ------------------------------- queries -------------------------------- */

export const activeJourneyQuery = (userId: string | undefined) =>
  queryOptions({
    queryKey: ["safe-journey-active", userId],
    enabled: Boolean(userId),
    refetchInterval: 30_000,
    queryFn: async (): Promise<SafeJourney | null> => {
      const { data, error } = await supabase
        .from("safe_journeys")
        .select("*")
        .eq("user_id", userId!)
        .in("status", LIVE_JOURNEY_STATUSES)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (error) throw new Error(error.message);
      return data;
    },
  });

export const journeyHistoryQuery = (userId: string | undefined) =>
  queryOptions({
    queryKey: ["safe-journey-history", userId],
    enabled: Boolean(userId),
    queryFn: async (): Promise<SafeJourney[]> => {
      const { data, error } = await supabase
        .from("safe_journeys")
        .select("*")
        .eq("user_id", userId!)
        .order("created_at", { ascending: false })
        .limit(30);
      if (error) throw new Error(error.message);
      return data ?? [];
    },
  });

export const journeyEventsQuery = (journeyId: string | undefined) =>
  queryOptions({
    queryKey: ["safe-journey-events", journeyId],
    enabled: Boolean(journeyId),
    queryFn: async (): Promise<SafeJourneyEvent[]> => {
      const { data, error } = await supabase
        .from("safe_journey_events")
        .select("*")
        .eq("journey_id", journeyId!)
        .order("created_at", { ascending: true });
      if (error) throw new Error(error.message);
      return data ?? [];
    },
  });

export const journeyNotificationsQuery = (journeyId: string | undefined) =>
  queryOptions({
    queryKey: ["safe-journey-notifications", journeyId],
    enabled: Boolean(journeyId),
    queryFn: async (): Promise<SafeJourneyNotification[]> => {
      const { data, error } = await supabase
        .from("safe_journey_notifications")
        .select("*")
        .eq("journey_id", journeyId!)
        .order("created_at", { ascending: true });
      if (error) throw new Error(error.message);
      return data ?? [];
    },
  });

export const safetyCircleQuery = (userId: string | undefined) =>
  queryOptions({
    queryKey: ["safety-circle", userId],
    enabled: Boolean(userId),
    queryFn: async (): Promise<SafetyCircleMember[]> => {
      const { data, error } = await supabase
        .from("safety_circle_members")
        .select("*")
        .eq("user_id", userId!)
        .order("created_at", { ascending: true });
      if (error) throw new Error(error.message);
      return data ?? [];
    },
  });

export type GuardianJourney = {
  journey_id: string;
  traveller_name: string;
  journey_name: string;
  destination_address: string;
  status: string;
  expected_arrival_at: string;
  last_latitude: number | null;
  last_longitude: number | null;
  last_location_at: string | null;
  guardian_notified_at: string | null;
  emergency_id: string | null;
  traveller_phone: string | null;
};

/**
 * Journeys shared with the signed-in account as guardian. The database function
 * matches the account email against the journey's nominated guardian, so a
 * guardian can never see a journey that was not shared with them.
 */
export const guardianJourneysQuery = (userId: string | undefined) =>
  queryOptions({
    queryKey: ["guardian-safe-journeys", userId],
    enabled: Boolean(userId),
    refetchInterval: 30_000,
    queryFn: async (): Promise<GuardianJourney[]> => {
      const { data, error } = await supabase.rpc("guardian_safe_journeys");
      if (error) throw new Error(error.message);
      return (data ?? []) as GuardianJourney[];
    },
  });

/* ------------------------------ mutations ------------------------------- */

export type StartJourneyInput = {
  name: string;
  guardianContactId: string;
  originAddress: string | null;
  originLatitude: number | null;
  originLongitude: number | null;
  destinationAddress: string;
  destinationLatitude: number | null;
  destinationLongitude: number | null;
  expectedArrivalAt: string;
  checkInIntervalMinutes: number | null;
  gracePeriodMinutes: number;
  sharingEnabled: boolean;
  notifyOnStart: boolean;
  notifyOnComplete: boolean;
  notifyOnMissed: boolean;
};

export async function startJourney(input: StartJourneyInput): Promise<SafeJourney> {
  const { data, error } = await supabase.rpc("start_safe_journey", {
    _payload: {
      name: input.name,
      guardian_contact_id: input.guardianContactId,
      origin_address: input.originAddress,
      origin_latitude: input.originLatitude,
      origin_longitude: input.originLongitude,
      destination_address: input.destinationAddress,
      destination_latitude: input.destinationLatitude,
      destination_longitude: input.destinationLongitude,
      expected_arrival_at: input.expectedArrivalAt,
      check_in_interval_minutes: input.checkInIntervalMinutes,
      grace_period_minutes: input.gracePeriodMinutes,
      sharing_enabled: input.sharingEnabled,
      notify_guardian_on_start: input.notifyOnStart,
      notify_guardian_on_complete: input.notifyOnComplete,
      notify_guardian_on_missed: input.notifyOnMissed,
    },
  });
  if (error) throw new Error(error.message);
  return data as unknown as SafeJourney;
}

/** Every status change goes through the server state machine. */
export async function transitionJourney(
  journeyId: string,
  to: JourneyStatus,
  note?: string,
): Promise<SafeJourney> {
  const { data, error } = await supabase.rpc("safe_journey_transition", {
    _journey_id: journeyId,
    _to: to,
    _note: note ?? null,
  });
  if (error) throw new Error(error.message);
  return data as unknown as SafeJourney;
}

export async function pushJourneyLocation(input: {
  journeyId: string;
  latitude: number;
  longitude: number;
  accuracy?: number | null;
  capturedAt?: Date;
}) {
  const { error } = await supabase.rpc("safe_journey_location", {
    _journey_id: input.journeyId,
    _latitude: input.latitude,
    _longitude: input.longitude,
    _accuracy: input.accuracy ?? null,
    _captured_at: (input.capturedAt ?? new Date()).toISOString(),
  });
  if (error) throw new Error(error.message);
}

export async function attachJourneyToEmergency(journeyId: string, emergencyId: string) {
  const { error } = await supabase.rpc("safe_journey_attach_emergency", {
    _journey_id: journeyId,
    _emergency_id: emergencyId,
  });
  if (error) throw new Error(error.message);
}

/* ---------------------------- notifications ----------------------------- */

export type JourneyNotificationEvent =
  | "JOURNEY_STARTED"
  | "JOURNEY_CHECK_IN_REQUIRED"
  | "JOURNEY_CHECK_IN_MISSED"
  | "GUARDIAN_NOTIFIED"
  | "JOURNEY_COMPLETED"
  | "JOURNEY_CANCELLED";

type LedgerChannel = "in_app" | "email" | "whatsapp";

/**
 * Claims one notification slot. The unique index on
 * (journey, event, channel, recipient) makes this idempotent: a retry either
 * reuses the pending row or, when the earlier attempt already succeeded,
 * returns null so nothing is sent or recorded twice.
 */
async function claimNotification(input: {
  journey: SafeJourney;
  event: JourneyNotificationEvent;
  channel: LedgerChannel;
  recipient: string;
  contactId?: string | null;
}): Promise<SafeJourneyNotification | null> {
  const existing = await supabase
    .from("safe_journey_notifications")
    .select("*")
    .eq("journey_id", input.journey.id)
    .eq("event_type", input.event)
    .eq("channel", input.channel)
    .eq("recipient_label", input.recipient)
    .maybeSingle();
  if (existing.error) throw new Error(existing.error.message);
  if (existing.data) return existing.data.status === "sent" ? null : existing.data;

  const inserted = await supabase
    .from("safe_journey_notifications")
    .insert({
      journey_id: input.journey.id,
      user_id: input.journey.user_id,
      event_type: input.event,
      channel: input.channel,
      recipient_label: input.recipient,
      recipient_contact_id: input.contactId ?? null,
      status: "queued",
    })
    .select("*")
    .maybeSingle();
  // A parallel tab won the race: the other attempt owns this notification.
  if (inserted.error) return null;
  return inserted.data;
}

async function settleNotification(
  id: string,
  status: "sent" | "failed" | "unavailable",
  error?: string,
) {
  await supabase
    .from("safe_journey_notifications")
    .update({
      status,
      error: error ?? null,
      sent_at: status === "sent" ? new Date().toISOString() : null,
    })
    .eq("id", id);
}

function journeyReference(journey: SafeJourney) {
  return journey.id.slice(0, 8).toUpperCase();
}

function journeyLocationLine(journey: SafeJourney) {
  if (journey.last_latitude == null || journey.last_longitude == null) {
    return { text: "No location update available", link: "Not available" };
  }
  return {
    text: `${journey.last_latitude.toFixed(5)}, ${journey.last_longitude.toFixed(5)}`,
    link: mapsLink({ lat: journey.last_latitude, lng: journey.last_longitude }),
  };
}

/** Wording is deliberately factual — RESQORA never claims an accident. */
export function journeyMessage(
  journey: SafeJourney,
  event: JourneyNotificationEvent,
  travellerName: string,
) {
  const eta = new Date(journey.expected_arrival_at).toLocaleString();
  const location = journeyLocationLine(journey);
  const updated = journey.last_location_at
    ? new Date(journey.last_location_at).toLocaleTimeString()
    : "no update received";
  const route = `${journey.origin_address ?? "start point"} → ${journey.destination_address}`;
  switch (event) {
    case "JOURNEY_STARTED":
      return {
        title: "Safe Journey started",
        body: `${travellerName} started a Safe Journey.\nJourney: ${journey.name}\nRoute: ${route}\nExpected arrival: ${eta}`,
      };
    case "JOURNEY_CHECK_IN_REQUIRED":
      return {
        title: "Safe Journey check-in required",
        body: `Your Safe Journey has reached its expected arrival time. Are you safe?\nJourney: ${journey.name}\nExpected arrival: ${eta}`,
      };
    case "JOURNEY_CHECK_IN_MISSED":
      return {
        title: "Safe Journey check-in missed",
        body: `No confirmation received for ${journey.name}.\nExpected arrival: ${eta}\nLast available location: ${location.text}\nLast location update: ${updated}`,
      };
    case "GUARDIAN_NOTIFIED":
      return {
        title: "Safe Journey check-in missed",
        body: `Safe Journey check-in missed.\nTraveller: ${travellerName}\nJourney: ${route}\nExpected arrival: ${eta}\nLast available location: ${location.text}\nLast location update: ${updated}\nStatus: No confirmation received. This is not a confirmed emergency — please contact ${travellerName}.\nMap: ${location.link}`,
      };
    case "JOURNEY_COMPLETED":
      return {
        title: "Safe Journey completed",
        body: `Safe Journey completed. ${travellerName} has marked the journey as safe.\nJourney: ${journey.name}\nRoute: ${route}`,
      };
    case "JOURNEY_CANCELLED":
      return {
        title: "Safe Journey cancelled",
        body: `${travellerName} cancelled the Safe Journey "${journey.name}".`,
      };
  }
}

export type JourneyNotifyOutcome = {
  channel: LedgerChannel;
  recipient: string;
  status: "sent" | "failed" | "unavailable" | "skipped";
  detail: string;
};

/**
 * Sends one journey notification through the channels RESQORA already has:
 * the in-app notification table for the traveller, and EmailJS for the
 * guardian. WhatsApp cannot be delivered without a paid Business API, so a
 * ready-to-send message is prepared instead and never claimed as delivered.
 */
export async function notifyJourneyEvent(input: {
  journey: SafeJourney;
  event: JourneyNotificationEvent;
  profile: Profile | null | undefined;
  /** Notify the guardian too (respects the journey's own preference flags). */
  guardian?: boolean;
}): Promise<JourneyNotifyOutcome[]> {
  const travellerName = input.profile?.full_name || "The RESQORA user";
  const message = journeyMessage(input.journey, input.event, travellerName);
  const outcomes: JourneyNotifyOutcome[] = [];

  // 1. In-app notification for the traveller (a real database row).
  const own = await claimNotification({
    journey: input.journey,
    event: input.event,
    channel: "in_app",
    recipient: "you",
  });
  if (own) {
    const { error } = await supabase.from("notifications").insert({
      user_id: input.journey.user_id,
      category: "safe_journey",
      title: message.title,
      body: message.body,
    });
    await settleNotification(own.id, error ? "failed" : "sent", error?.message);
    outcomes.push({
      channel: "in_app",
      recipient: "you",
      status: error ? "failed" : "sent",
      detail: error ? error.message : "Saved to your notifications",
    });
  }

  // 2. Guardian channels, only when the user opted in for this event.
  const wantsGuardian =
    input.guardian &&
    ((input.event === "JOURNEY_STARTED" && input.journey.notify_guardian_on_start) ||
      (input.event === "JOURNEY_COMPLETED" && input.journey.notify_guardian_on_complete) ||
      (input.event === "GUARDIAN_NOTIFIED" && input.journey.notify_guardian_on_missed) ||
      input.event === "JOURNEY_CANCELLED");

  if (wantsGuardian) {
    const guardianLabel = input.journey.guardian_name;
    if (input.journey.guardian_email) {
      const slot = await claimNotification({
        journey: input.journey,
        event: input.event,
        channel: "email",
        recipient: input.journey.guardian_email,
        contactId: input.journey.guardian_contact_id,
      });
      if (slot) {
        if (!isEmailConfigured()) {
          await settleNotification(slot.id, "unavailable", "Email service is not configured.");
          outcomes.push({
            channel: "email",
            recipient: guardianLabel,
            status: "unavailable",
            detail: "Email service is not configured, so no email was sent.",
          });
        } else {
          const location = journeyLocationLine(input.journey);
          const result = await sendEmergencyTemplateEmail({
            to_email: input.journey.guardian_email,
            user_name: travellerName,
            time: new Date().toLocaleString(),
            address: input.journey.destination_address,
            map_link: location.link,
            tracking_link: "Not available",
            emergency_id: journeyReference(input.journey),
            reply_to: input.profile?.email || "no-reply@resqora.app",
            status: message.title,
            support_contact: input.profile?.phone || input.profile?.email || "",
            message_html: `<pre style="font-family:inherit;white-space:pre-wrap">${message.body.replace(/[<>&]/g, "")}</pre>`,
          });
          await settleNotification(
            slot.id,
            result.ok ? "sent" : "failed",
            result.ok ? undefined : result.error,
          );
          outcomes.push({
            channel: "email",
            recipient: guardianLabel,
            status: result.ok ? "sent" : "failed",
            detail: result.ok ? "Email accepted by the provider" : result.error,
          });
        }
      }
    }

    // WhatsApp: prepared, not auto-delivered.
    if (input.journey.guardian_phone) {
      const { href, problem } = whatsappShareLink(
        `${message.title}\n\n${message.body}`,
        input.journey.guardian_phone,
        input.profile?.phone,
      );
      outcomes.push({
        channel: "whatsapp",
        recipient: guardianLabel,
        status: href ? "skipped" : "unavailable",
        detail: href
          ? "A ready-to-send WhatsApp message is available on the journey screen."
          : (problem ?? "This number cannot be used for WhatsApp."),
      });
    }
  }

  return outcomes;
}

/** Ready-to-send WhatsApp link for the guardian (manual send, honest status). */
export function journeyWhatsappLink(
  journey: SafeJourney,
  event: JourneyNotificationEvent,
  profile: Profile | null | undefined,
) {
  const message = journeyMessage(journey, event, profile?.full_name || "The RESQORA user");
  return whatsappShareLink(
    `${message.title}\n\n${message.body}`,
    journey.guardian_phone,
    profile?.phone,
  );
}

/* ------------------------------ analytics ------------------------------- */

/**
 * Privacy-conscious product analytics: reuses the existing activity log and
 * records the event name only — never coordinates.
 */
export function trackJourneyEvent(
  userId: string | undefined,
  event:
    | "journey_started"
    | "journey_completed"
    | "check_in_completed"
    | "check_in_missed"
    | "guardian_notified"
    | "journey_cancelled"
    | "emergency_from_journey",
  detail?: string,
) {
  void logActivity(userId, `Safe Journey: ${event}`, detail);
}

/* -------------------------------- helpers ------------------------------- */

export function distanceToDestinationKm(
  journey: SafeJourney,
  position: { lat: number; lng: number } | null,
) {
  if (!position || journey.destination_latitude == null || journey.destination_longitude == null) {
    return null;
  }
  return haversineKm(position, {
    lat: journey.destination_latitude,
    lng: journey.destination_longitude,
  });
}

export type LocationFreshness = "live" | "updating" | "low_accuracy" | "last_known" | "unavailable";

/**
 * Truthful location state. "Live" is only ever reported for a fix RESQORA has
 * actually received in the last two minutes while online.
 */
export function locationFreshness(input: {
  lastLocationAt: string | null;
  accuracy: number | null;
  online: boolean;
  gpsAvailable: boolean;
}): { state: LocationFreshness; label: string } {
  if (!input.lastLocationAt) {
    return input.gpsAvailable
      ? { state: "updating", label: "Getting your location…" }
      : { state: "unavailable", label: "Location unavailable" };
  }
  const ageMs = Date.now() - new Date(input.lastLocationAt).getTime();
  if (!input.online) return { state: "last_known", label: "Offline — last known location" };
  if (!input.gpsAvailable) return { state: "last_known", label: "Last known location" };
  if (ageMs > 5 * 60_000) return { state: "last_known", label: "Last known location" };
  if (ageMs > 2 * 60_000) return { state: "updating", label: "Updating…" };
  if (input.accuracy != null && input.accuracy > 200)
    return { state: "low_accuracy", label: "Low accuracy" };
  return { state: "live", label: "Live" };
}

export function minutesUntil(iso: string) {
  return Math.round((new Date(iso).getTime() - Date.now()) / 60_000);
}
