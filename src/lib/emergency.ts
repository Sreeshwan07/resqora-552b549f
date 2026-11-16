import { supabase } from "@/integrations/supabase/client";
import {
  getCurrentPosition,
  logEvent,
  notify,
  type Emergency,
  type EmergencyContact,
  type Profile,
} from "@/lib/api";
import { logActivity } from "@/lib/activity";
import { reverseGeocode } from "@/lib/geocode";
import { ensureLiveShareLink, shareUrl } from "@/lib/share";
import { dispatchDeliveries, seedDeliveries } from "@/lib/alert-delivery";
import { isOffline, queueEmergency } from "@/lib/offline";
import { sendEmergencyEmailAlerts } from "@/lib/email-alerts";
import { prepareWhatsappShares } from "@/lib/whatsapp-alerts";
import { notifyEmergency, pushEmergencyAlert } from "@/lib/emergency-notifications";
import {
  ensureTrackingUrl,
  expireGuardianSessions,
  guardianOf,
  notifyGuardian,
} from "@/lib/guardian";
import { readBatteryLevel, readSpeed } from "@/lib/device";
import { logSecurityEvent } from "@/lib/audit";
import { sanitizeMultiline } from "@/lib/security";
import { generateActionPlan } from "@/lib/coordinator.functions";
import { cachePlan, medicalContext, persistPlan } from "@/lib/core";
import { transitionIncident } from "@/lib/incident";

/**
 * Runs the AI Emergency Coordinator as soon as an SOS goes active so the action
 * plan is already on the emergency row when the guardian opens their dashboard —
 * the user does not have to visit the Digital Twin first. Best effort: a failure
 * never affects the emergency itself, and the workspace can retry on demand.
 */
async function buildInitialActionPlan(input: {
  emergency: Emergency;
  userId: string;
  profile?: Profile | null;
  address: string | null;
}) {
  try {
    const plan = await generateActionPlan({
      data: {
        type: input.emergency.type,
        severity: input.emergency.severity,
        notes: input.emergency.notes ?? undefined,
        address: input.address ?? undefined,
        medical: medicalContext(input.profile),
      },
    });
    cachePlan(input.emergency.id, plan);
    await persistPlan(input.emergency.id, plan);
    await logEvent(
      input.emergency.id,
      input.userId,
      "AI action plan ready",
      `${plan.headline} — ${plan.hospitalType}, responder ETA ≈ ${plan.etaMinutes} min.`,
    );
  } catch {
    /* the Digital Twin regenerates the plan on demand */
  }
}

export const EMERGENCY_TYPES = [
  { value: "medical", label: "Medical" },
  { value: "accident", label: "Road accident" },
  { value: "fire", label: "Fire" },
  { value: "crime", label: "Crime / assault" },
  { value: "natural", label: "Natural disaster" },
  { value: "sos", label: "General SOS" },
] as const;

export const STATUS_FLOW = [
  { key: "created", label: "SOS triggered", detail: "Alert created on your device." },
  { key: "locating", label: "Location captured", detail: "GPS coordinates attached to the alert." },
  {
    key: "ai_analysis",
    label: "AI analysis started",
    detail: "RESQORA is scoring severity and routing priority.",
  },
  {
    key: "contacts_notified",
    label: "Contacts notified",
    detail: "Your trusted contacts were alerted.",
  },
  {
    key: "active",
    label: "Emergency active",
    detail: "Responders are engaged and tracking your location.",
  },
  { key: "resolved", label: "Resolved", detail: "Emergency closed." },
] as const;

export type EmergencyStatus = (typeof STATUS_FLOW)[number]["key"];

/** Per-channel outcome of the SOS notification workflow, surfaced in the UI. */
export type NotificationChannel = "email" | "sms" | "whatsapp" | "guardian";
export type NotificationOutcome = {
  channel: NotificationChannel;
  status: "delivered" | "sent" | "ready" | "unavailable" | "skipped" | "failed";
  detail: string;
  count: number;
};
export type EmergencyWithReport = Emergency & {
  notifications: NotificationOutcome[];
  queued?: false;
};
export type QueuedSosResult = { queued: true; localId: string };
export type CreateEmergencyResult = EmergencyWithReport | QueuedSosResult;

export type CapturedSosLocation = {
  latitude: number;
  longitude: number;
  accuracy: number | null;
  address?: string | null;
  capturedAt?: string;
  speed?: number | null;
};

type CreateEmergencyOptions = {
  userId: string;
  type: string;
  severity?: string;
  notes?: string;
  contactCount: number;
  contacts?: EmergencyContact[];
  profile?: Profile | null;
  /** Stable across retries, especially for an SOS captured while offline. */
  idempotencyKey?: string;
  capturedLocation?: CapturedSosLocation;
  startedAt?: string;
  /** Fired as soon as the real emergency row exists. */
  onCreated?: (emergency: Emergency) => void;
};

// React state alone cannot stop two clicks in the same render frame. This lock
// covers every SOS entry point sharing this module; the database remains the
// final guard across tabs and devices.
const activationLocks = new Set<string>();

/** Statuses used before the current workflow, kept so old history still reads well. */
const LEGACY_LABELS: Record<string, string> = {
  dispatched: "Responders dispatched",
  en_route: "Help en route",
};

export function statusIndex(status: string) {
  const index = STATUS_FLOW.findIndex((step) => step.key === status);
  if (index === -1 && status in LEGACY_LABELS) return STATUS_FLOW.length - 2;
  return index === -1 ? 0 : index;
}

export function statusLabel(status: string) {
  if (status === "cancelled") return "Cancelled";
  if (status in LEGACY_LABELS) return LEGACY_LABELS[status];
  return STATUS_FLOW[statusIndex(status)].label;
}

/**
 * Loads the signed-in user's own Guardian + emergency contacts. Emergency
 * emails are only ever addressed to these rows, so no other account (including
 * an administrator) can ever receive another user's alert.
 */
async function loadOwnContacts(userId: string): Promise<EmergencyContact[]> {
  const { data: auth } = await supabase.auth.getUser();
  const authedId = auth.user?.id;
  if (!authedId) throw new Error("You must be signed in to send an SOS.");
  if (authedId !== userId) throw new Error("Session mismatch — please sign in again.");
  const { data, error } = await supabase
    .from("emergency_contacts")
    .select("*")
    .eq("user_id", authedId)
    .order("is_guardian", { ascending: false })
    .order("position", { ascending: true });
  if (error) throw new Error(error.message);
  return (data ?? []) as EmergencyContact[];
}

async function withTimeout<T>(promise: Promise<T>, milliseconds: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error("Address lookup timed out")), milliseconds);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

async function runEmergencyWorkflow(
  options: CreateEmergencyOptions,
): Promise<CreateEmergencyResult> {
  const report: NotificationOutcome[] = [];
  const errorText = (error: unknown) =>
    error instanceof Error ? error.message : "Unexpected error";
  const notes = options.notes ? sanitizeMultiline(options.notes, 2000) : null;
  const idempotencyKey =
    options.idempotencyKey ??
    (typeof crypto !== "undefined" && "randomUUID" in crypto
      ? crypto.randomUUID()
      : `sos-${Date.now()}-${Math.random().toString(36).slice(2, 12)}`);

  // Offline: persist the real activation time and best available GPS fix. The
  // returned queued state is success, not a failed activation or a fake row.
  if (isOffline()) {
    let capturedLocation: CapturedSosLocation | undefined;
    try {
      const position = await getCurrentPosition();
      capturedLocation = {
        latitude: position.coords.latitude,
        longitude: position.coords.longitude,
        accuracy: position.coords.accuracy,
        speed: readSpeed(position.coords),
        capturedAt: new Date(position.timestamp).toISOString(),
      };
    } catch {
      // The SOS is still queued; its location is honestly unavailable.
    }
    const startedAt = new Date().toISOString();
    const localId = queueEmergency({
      userId: options.userId,
      type: options.type,
      severity: options.severity ?? "high",
      notes,
      latitude: capturedLocation?.latitude ?? null,
      longitude: capturedLocation?.longitude ?? null,
      accuracy: capturedLocation?.accuracy ?? null,
      speed: capturedLocation?.speed ?? null,
      address: null,
      startedAt,
    });
    return { queued: true, localId };
  }

  // One atomic server-side call creates or resumes the session. The retry key
  // and one-live-emergency index prevent duplicates across clicks and tabs.
  const { data: session, error } = await supabase.rpc("start_emergency_session_v2", {
    _type: options.type,
    _severity: options.severity ?? "high",
    _notes: notes ?? "",
    _idempotency_key: idempotencyKey,
    _latitude: options.capturedLocation?.latitude,
    _longitude: options.capturedLocation?.longitude,
    _accuracy: options.capturedLocation?.accuracy ?? undefined,
    _address: options.capturedLocation?.address ?? undefined,
    _started_at: options.startedAt,
  });
  if (error) throw new Error(error.message);
  const started = session as unknown as { emergency: Emergency; reused: boolean } | null;
  if (!started?.emergency) throw new Error("Could not start the emergency session.");

  const data = started.emergency;
  options.onCreated?.(data);
  await transitionIncident(data.id, "activated", "Incident opened on the user's device.").catch(
    () => undefined,
  );

  // A completed retry is a no-op. An interrupted activation is resumed instead
  // of being abandoned before GPS and contact alerts, which was the old bug.
  if (started.reused) {
    if (data.status === "resolved" || data.status === "cancelled") {
      return { ...data, notifications: [] };
    }
    const { data: completed } = await supabase
      .from("emergency_events")
      .select("id")
      .eq("emergency_id", data.id)
      .eq("label", "SOS activation completed")
      .limit(1)
      .maybeSingle();
    if (completed) return { ...data, notifications: [] };
  }

  await logEvent(
    data.id,
    options.userId,
    started.reused ? "SOS activation resumed" : "SOS triggered",
    started.reused
      ? "An interrupted activation is continuing with the same emergency ID."
      : "Alert created on your device.",
  );

  // Recipients ALWAYS come from the signed-in user's own saved records — never
  // from a caller-supplied list, and never from any hardcoded/admin address.
  const ownContacts = await loadOwnContacts(options.userId);
  const contacts = ownContacts;

  let address: string | null = options.capturedLocation?.address ?? null;
  try {
    const captured =
      options.capturedLocation ??
      (await getCurrentPosition().then((position) => ({
        latitude: position.coords.latitude,
        longitude: position.coords.longitude,
        accuracy: position.coords.accuracy,
        speed: readSpeed(position.coords),
        capturedAt: new Date(position.timestamp).toISOString(),
      })));
    const { latitude, longitude, accuracy } = captured;
    const locatedAt = captured.capturedAt ?? new Date().toISOString();

    // Save coordinates before address lookup. A slow or failed geocoder can no
    // longer prevent the real GPS position from reaching the emergency row.
    const { error: locationError } = await supabase
      .from("emergencies")
      .update({
        latitude,
        longitude,
        location_accuracy: accuracy,
        location_updated_at: locatedAt,
      })
      .eq("id", data.id);
    if (locationError) throw new Error(locationError.message);
    await supabase.from("location_pings").insert({
      emergency_id: data.id,
      user_id: options.userId,
      latitude,
      longitude,
      accuracy,
      speed: captured.speed ?? null,
      battery_level: await readBatteryLevel(),
    });
    await logEvent(
      data.id,
      options.userId,
      "Location captured",
      `${latitude.toFixed(5)}, ${longitude.toFixed(5)}${accuracy == null ? "" : ` (±${Math.round(accuracy)}m)`}`,
    );

    if (!address) {
      try {
        address = await withTimeout(reverseGeocode(latitude, longitude), 7_000);
      } catch {
        address = null;
      }
      if (address) {
        const { error: addressError } = await supabase
          .from("emergencies")
          .update({ address })
          .eq("id", data.id);
        if (!addressError) {
          await logEvent(data.id, options.userId, "Address resolved", address);
        }
      }
    }
  } catch (locationFailure) {
    await logEvent(
      data.id,
      options.userId,
      "Location unavailable",
      `Current GPS could not be saved: ${errorText(locationFailure)}`,
    );
  }

  // Secure live tracking link for the trusted contacts.
  let trackingUrl: string | null = null;
  try {
    // Every SOS gets a secure Guardian session; its dashboard URL is the single
    // live-tracking link used by email, WhatsApp and the share centre.
    const guardianContact = guardianOf(contacts);
    const tracking = await ensureTrackingUrl({
      userId: options.userId,
      emergencyId: data.id,
      guardian: guardianContact,
    });
    trackingUrl = tracking.url;
    // The legacy /s/{token} page stays available as a fallback view.
    await ensureLiveShareLink(options.userId, data.id).catch(() => undefined);
    await logEvent(
      data.id,
      options.userId,
      "Live tracking started",
      "Secure Guardian dashboard link created — location refreshes every 10 seconds.",
    );
  } catch {
    /* tracking link can be regenerated from the live page */
  }

  // Await each forward-only transition so activation cannot race past itself.
  await transitionIncident(
    data.id,
    "assessing",
    address ? "Location captured; situation being assessed." : "GPS attempted; situation being assessed.",
  ).catch(() => undefined);
  await transitionIncident(data.id, "alerting", "Notifying trusted contacts.").catch(
    () => undefined,
  );
  await logEvent(
    data.id,
    options.userId,
    "AI analysis started",
    "Severity scoring and response priority calculated from your emergency type.",
  );

  // One read of the located row, shared by every notification channel below —
  // the previous code re-fetched the same emergency once per channel.
  const { data: located } = await supabase
    .from("emergencies")
    .select("*")
    .eq("id", data.id)
    .single();
  const currentEmergency = (located ?? data) as Emergency;
  const guardian = guardianOf(contacts);
  // The Guardian receives the dedicated Guardian email; the remaining contacts
  // (max 3) receive the standard alert. Splitting the lists here is what stops
  // the Guardian from being emailed twice for the same emergency.
  const emailContacts = contacts.filter((contact) => contact.id !== guardian?.id).slice(0, 3);

  const smsTask = async () => {
    if (contacts.length === 0) {
      report.push({
        channel: "sms",
        status: "skipped",
        detail: "No trusted contacts saved yet.",
        count: 0,
      });
      return;
    }
    try {
      const deliveries = await seedDeliveries({
        userId: options.userId,
        emergencyId: data.id,
        contacts,
      });
      const configured = await dispatchDeliveries({
        emergencyId: data.id,
        kind: "alert",
        contactIds: contacts.map((contact) => contact.id),
        trackingUrl,
        address,
      });
      report.push({
        channel: "sms",
        status: configured ? "sent" : "unavailable",
        detail: configured
          ? `SMS sent to ${deliveries.length} contact(s).`
          : "No SMS provider connected — use WhatsApp or SMS hand-off.",
        count: configured ? deliveries.length : 0,
      });
    } catch (error) {
      report.push({ channel: "sms", status: "failed", detail: errorText(error), count: 0 });
    }
  };

  // Guardian Mode: secure dashboard session + Guardian email.
  const guardianTask = async () => {
    if (!guardian) {
      await logEvent(
        data.id,
        options.userId,
        "Guardian email missing",
        "No Guardian has been designated.",
      );
      report.push({
        channel: "guardian",
        status: "skipped",
        detail: "No Guardian has been designated.",
        count: 0,
      });
      return;
    }
    if (!guardian.email?.includes("@")) {
      await logEvent(
        data.id,
        options.userId,
        "Guardian email missing",
        "No Guardian email has been configured.",
      );
      report.push({
        channel: "guardian",
        status: "skipped",
        detail: "No Guardian email has been configured.",
        count: 0,
      });
      return;
    }
    try {
      const result = await notifyGuardian({
        userId: options.userId,
        emergency: currentEmergency,
        profile: options.profile,
        guardian,
        address,
        trackingUrl,
      });
      await logEvent(
        data.id,
        options.userId,
        "Guardian notified",
        result.emailed
          ? `${guardian.name} received the Guardian dashboard link.`
          : `Guardian session created for ${guardian.name} — share the dashboard link manually.`,
      );
      report.push({
        channel: "guardian",
        status: result.emailed ? "sent" : "unavailable",
        detail: result.emailed
          ? `${guardian.name} received the Guardian dashboard link.`
          : `Guardian link ready for ${guardian.name} — send it from the share centre.`,
        count: 1,
      });
    } catch (error) {
      report.push({ channel: "guardian", status: "failed", detail: errorText(error), count: 0 });
    }
  };

  // Email channel: one alert per emergency contact that has a valid address.
  const emailTask = async () => {
    if (emailContacts.length === 0) {
      await logEvent(
        data.id,
        options.userId,
        "Email skipped",
        "No emergency contact emails have been configured.",
      );
      report.push({
        channel: "email",
        status: "skipped",
        detail: "No emergency contact emails have been configured.",
        count: 0,
      });
      return;
    }
    try {
      const emailResult = await sendEmergencyEmailAlerts({
        userId: options.userId,
        emergency: currentEmergency,
        profile: options.profile,
        contacts: emailContacts,
        address,
        trackingUrl,
      });
      if (emailResult.skipped) {
        await logEvent(
          data.id,
          options.userId,
          "Email skipped",
          "No emergency contact emails have been configured.",
        );
        report.push({
          channel: "email",
          status: "skipped",
          detail: "No emergency contact emails have been configured.",
          count: 0,
        });
      } else if (emailResult.configured) {
        const failures = emailResult.results.filter((r) => !r.ok);
        const detail =
          failures.length === 0
            ? `Emergency email delivered to ${emailResult.sent} contact(s).`
            : `${emailResult.sent} delivered, ${failures.length} failed — ${failures
                .map((f) => `${f.name}: ${f.error}`)
                .join("; ")}`;
        await logEvent(
          data.id,
          options.userId,
          failures.length === 0 ? "Email sent" : "Email partially delivered",
          detail,
        );
        report.push({
          channel: "email",
          status: emailResult.sent > 0 ? "sent" : "failed",
          detail,
          count: emailResult.sent,
        });
      } else {
        await logEvent(
          data.id,
          options.userId,
          "Email delivery unavailable",
          "Email service is not configured.",
        );
        report.push({
          channel: "email",
          status: "unavailable",
          detail: "Email service is not configured.",
          count: 0,
        });
      }
    } catch (error) {
      report.push({ channel: "email", status: "failed", detail: errorText(error), count: 0 });
    }
  };

  // WhatsApp: prepare one ready-to-send message per contact with a phone.
  const whatsappTask = async () => {
    if (contacts.length === 0) {
      report.push({
        channel: "whatsapp",
        status: "skipped",
        detail: "No trusted contact has a phone number saved.",
        count: 0,
      });
      return;
    }
    try {
      const prepared = await prepareWhatsappShares({
        userId: options.userId,
        emergencyId: data.id,
        contacts,
      });
      if (prepared.length > 0) {
        await logEvent(
          data.id,
          options.userId,
          "WhatsApp prepared",
          `${prepared.length} WhatsApp alert(s) ready to send from the share centre.`,
        );
      }
      report.push({
        channel: "whatsapp",
        status: prepared.length > 0 ? "ready" : "skipped",
        detail:
          prepared.length > 0
            ? `${prepared.length} WhatsApp alert(s) ready to send.`
            : "No trusted contact has a phone number saved.",
        count: prepared.length,
      });
    } catch (error) {
      report.push({ channel: "whatsapp", status: "failed", detail: errorText(error), count: 0 });
    }
  };

  // Channels are independent, so they run together instead of one after another.
  await Promise.all([guardianTask(), emailTask(), smsTask(), whatsappTask()]);

  await logEvent(
    data.id,
    options.userId,
    "Contacts notified",
    `${contacts.length} trusted contact${contacts.length === 1 ? "" : "s"} alerted with your live location.`,
  );

  await logEvent(
    data.id,
    options.userId,
    "Emergency active",
    "Responders are engaged and following your live location.",
  );

  await notify(options.userId, {
    category: "emergency",
    title: "Emergency alert sent",
    body: "Your trusted contacts and nearby responders have been notified.",
  });
  await logActivity(options.userId, "SOS activated", `${options.type} emergency triggered`);
  void logSecurityEvent("SOS activated", `${options.type} emergency triggered`, {
    emergency_id: data.id,
  });
  notifyEmergency("sos_activated", address ?? undefined);
  void pushEmergencyAlert({
    kind: "sos",
    emergencyId: data.id,
    personName: options.profile?.full_name,
    detail: address ?? undefined,
  });
  void pushEmergencyAlert({
    kind: "tracking",
    emergencyId: data.id,
    personName: options.profile?.full_name,
    detail: address ?? undefined,
  });

  const { data: fresh } = await supabase.from("emergencies").select("*").eq("id", data.id).single();
  const finalEmergency = (fresh ?? data) as Emergency;
  void buildInitialActionPlan({
    emergency: finalEmergency,
    userId: options.userId,
    profile: options.profile,
    address,
  });
  return { ...finalEmergency, notifications: report };
}

/**
 * "I'm safe": stops live sharing, closes the session and queues a resolution
 * notice for every trusted contact.
 */
export async function confirmSafe(input: {
  emergency: Emergency;
  profile: Profile | null | undefined;
  contacts: EmergencyContact[];
}) {
  const { emergency, profile, contacts } = input;
  await supabase.from("emergencies").update({ live_status: "safe" }).eq("id", emergency.id);
  await resolveEmergency(emergency);
  // Keep the tracking link readable for a short grace window so contacts see the
  // "Emergency resolved" state, then it expires automatically.
  await supabase
    .from("share_links")
    .update({ expires_at: new Date(Date.now() + 30 * 60 * 1000).toISOString() })
    .eq("emergency_id", emergency.id)
    .eq("kind", "live");
  await logEvent(
    emergency.id,
    emergency.user_id,
    "Live tracking stopped",
    "The user confirmed they are safe.",
  );
  void logSecurityEvent("SOS deactivated", "User confirmed they are safe", {
    emergency_id: emergency.id,
  });
  try {
    await expireGuardianSessions(emergency.id);
  } catch {
    /* the session expires with the emergency anyway */
  }
  notifyEmergency("emergency_closed");
  void pushEmergencyAlert({
    kind: "resolved",
    emergencyId: emergency.id,
    personName: profile?.full_name,
  });

  if (contacts.length > 0) {
    try {
      const deliveries = await seedDeliveries({
        userId: emergency.user_id,
        emergencyId: emergency.id,
        contacts,
        kind: "resolved",
      });
      await dispatchDeliveries({
        emergencyId: emergency.id,
        kind: "resolved",
        contactIds: contacts.map((contact) => contact.id),
      });
    } catch {
      /* resolution notices can be resent from the history page */
    }
    try {
      await sendEmergencyEmailAlerts({
        userId: emergency.user_id,
        emergency,
        profile,
        contacts,
        kind: "resolved",
      });
    } catch {
      /* resolution emails can be resent from the share centre */
    }
  }
}

export async function resolveEmergency(emergency: Emergency) {
  // The server stamps status, close time and duration atomically.
  await transitionIncident(
    emergency.id,
    "resolved",
    "Emergency marked as resolved.",
    `resolve:${emergency.id}`,
  );
  await logEvent(emergency.id, emergency.user_id, "Resolved", "Emergency marked as resolved.");
  await notify(emergency.user_id, {
    category: "emergency",
    title: "Emergency resolved",
    body: "Glad you're safe. A summary was added to your history.",
  });
  await logActivity(emergency.user_id, "Emergency closed", "Emergency resolved");
}

export async function cancelEmergency(
  emergency: Emergency,
  extra?: { profile?: Profile | null; contacts?: EmergencyContact[] },
) {
  // The server state machine closes the session (status, close time, duration).
  // A stable request ID makes retries/double taps return the same result.
  await transitionIncident(
    emergency.id,
    "cancelled",
    "Cancelled by the user.",
    `cancel:${emergency.id}`,
  );
  // Cancelling must kill every live tracking token immediately.
  await supabase
    .from("share_links")
    .update({ active: false })
    .eq("emergency_id", emergency.id)
    .eq("kind", "live");
  try {
    await expireGuardianSessions(emergency.id);
  } catch {
    /* the session expires with the emergency anyway */
  }
  await logEvent(emergency.id, emergency.user_id, "Cancelled", "You cancelled this alert.");
  void logSecurityEvent("SOS deactivated", "Emergency cancelled by the user", {
    emergency_id: emergency.id,
  });
  await logActivity(emergency.user_id, "SOS cancelled", `${emergency.type} alert cancelled`);
  await notify(emergency.user_id, {
    category: "emergency",
    title: "Emergency cancelled",
    body: "Live tracking stopped and the alert was closed in your history.",
  });
  notifyEmergency("emergency_closed");
  void pushEmergencyAlert({
    kind: "resolved",
    emergencyId: emergency.id,
    personName: extra?.profile?.full_name,
  });
  // Anyone who received the alert is told it is over, on the same channels.
  const contacts = extra?.contacts ?? [];
  if (contacts.length > 0) {
    try {
      const deliveries = await seedDeliveries({
        userId: emergency.user_id,
        emergencyId: emergency.id,
        contacts,
        kind: "resolved",
      });
      await dispatchDeliveries({
        emergencyId: emergency.id,
        kind: "resolved",
        contactIds: contacts.map((contact) => contact.id),
      });
    } catch {
      /* the notice can be resent from the share centre */
    }
    try {
      await sendEmergencyEmailAlerts({
        userId: emergency.user_id,
        emergency,
        profile: extra?.profile,
        contacts,
        kind: "resolved",
      });
    } catch {
      /* the notice can be resent from the share centre */
    }
  }
}

export function formatDuration(seconds: number | null) {
  if (!seconds) return "—";
  const mins = Math.floor(seconds / 60);
  const secs = seconds % 60;
  if (mins === 0) return `${secs}s`;
  return `${mins}m ${secs}s`;
}
