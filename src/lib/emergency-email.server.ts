import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";
import { sendProviderEmail, type ProviderResult } from "./email-provider.server";

export type EmailKind = "alert" | "resolved" | "guardian";
type Db = SupabaseClient<Database>;

export type EmailOutcome = {
  deliveryId: string;
  contactId: string;
  name: string;
  status: "sent" | "failed" | "duplicate";
  error?: string;
};

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

function esc(v: string) {
  return v.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
}

/** Only same-app tracking paths scoped to this emergency are allowed in emails. */
export function safeTrackingUrl(raw: string | undefined, emergencyId: string, origin: string) {
  if (!raw) return null;
  try {
    const url = new URL(raw, origin);
    if (url.origin !== origin) return null;
    if (url.pathname.startsWith(`/guardian/${emergencyId}/`)) return url.toString();
    if (/^\/s\/[A-Za-z0-9_-]{16,}$/.test(url.pathname)) return url.toString();
    return null;
  } catch {
    return null;
  }
}

export function buildServerEmail(input: {
  kind: EmailKind;
  name: string;
  reference: string;
  status: string;
  location: string;
  locationStatus: string;
  type: string;
  trackingUrl: string | null;
}) {
  const time = new Date().toUTCString();
  if (input.kind === "resolved") {
    const text = `RESQORA Emergency Resolved\n\n${input.name} has confirmed they are safe.\nEmergency ID: ${input.reference}\nTime: ${time}\nLive location sharing has stopped.`;
    return {
      subject: `RESQORA Emergency Resolved — ${input.name}`,
      text,
      html: `<pre style="font-family:Arial,sans-serif;white-space:pre-wrap">${esc(text)}</pre>`,
    };
  }
  const lines = [
    "RESQORA Emergency Alert",
    "",
    "An emergency session has been activated for:",
    input.name,
    "",
    `Emergency ID: ${input.reference}`,
    `Status: ${input.status}`,
    `Location: ${input.location}`,
    `Location status: ${input.locationStatus}`,
    `Incident: ${input.type}`,
    `Emergency session: ${input.trackingUrl ?? "Not available"}`,
    `Timestamp: ${time}`,
    "",
    "This is an emergency coordination alert. If immediate professional help is needed, call 112.",
  ];
  const text = lines.join("\n");
  const button = input.trackingUrl
    ? `<p><a href="${esc(input.trackingUrl)}" style="display:inline-block;background:#dc2626;color:#fff;padding:14px 26px;border-radius:12px;text-decoration:none;font-weight:700">View emergency session</a></p>`
    : "";
  return {
    subject: "RESQORA Emergency Alert — Immediate Attention Required",
    text,
    html: `<div style="font-family:Arial,sans-serif;font-size:15px;line-height:1.6">${button}<pre style="font-family:inherit;white-space:pre-wrap">${esc(text)}</pre></div>`,
  };
}

/**
 * Core dispatch. `userDb` acts as the caller (RLS), `adminDb` writes delivery
 * rows. Recipients always come from the caller's saved contacts; requested
 * contact IDs outside that set are rejected.
 */
export async function dispatchEmergencyEmails(deps: {
  userDb: Db;
  adminDb: Db;
  userId: string;
  emergencyId: string;
  kind: EmailKind;
  contactIds?: string[];
  trackingUrl: string | null;
  send?: typeof sendProviderEmail;
}) {
  const send = deps.send ?? sendProviderEmail;
  const { data: emergency, error: eErr } = await deps.userDb
    .from("emergencies")
    .select("id,user_id,type,status,latitude,longitude,address,location_updated_at")
    .eq("id", deps.emergencyId)
    .maybeSingle();
  if (eErr) throw new Error("Could not read the emergency session.");
  if (!emergency || emergency.user_id !== deps.userId) throw new Error("FORBIDDEN");
  const terminal = ["resolved", "cancelled"].includes(emergency.status as string);
  if (deps.kind !== "resolved" && terminal) throw new Error("INVALID_STATE");

  const { data: contacts, error: cErr } = await deps.userDb
    .from("emergency_contacts")
    .select("id,name,email,user_id")
    .eq("user_id", deps.userId);
  if (cErr) throw new Error("Could not read emergency contacts.");
  const owned = new Map((contacts ?? []).map((c) => [c.id, c]));
  if (deps.contactIds?.some((id) => !owned.has(id))) throw new Error("UNAUTHORIZED_RECIPIENT");
  const seen = new Set<string>();
  const targets = (deps.contactIds ?? [...owned.keys()])
    .map((id) => owned.get(id)!)
    .filter((c) => {
      const e = c.email?.trim().toLowerCase();
      if (!e || !EMAIL_RE.test(e) || seen.has(e)) return false;
      seen.add(e);
      return true;
    });
  if (targets.length === 0) return { skipped: true, outcomes: [] as EmailOutcome[] };

  const { data: profile } = await deps.userDb
    .from("profiles")
    .select("full_name")
    .eq("id", deps.userId)
    .maybeSingle();
  const hasCoords = emergency.latitude != null && emergency.longitude != null;
  const fresh =
    hasCoords &&
    emergency.location_updated_at &&
    Date.now() - new Date(emergency.location_updated_at).getTime() < 2 * 60_000;
  const content = buildServerEmail({
    kind: deps.kind,
    name: profile?.full_name || "A RESQORA user",
    reference: emergency.id.slice(0, 8).toUpperCase(),
    status: String(emergency.status).replace(/_/g, " "),
    location:
      emergency.address ||
      (hasCoords ? `${emergency.latitude}, ${emergency.longitude}` : "Unavailable"),
    locationStatus: fresh ? "Live" : hasCoords ? "Last known" : "Unavailable",
    type: String(emergency.type).replace(/_/g, " "),
    trackingUrl: deps.trackingUrl,
  });

  const rows = targets.map((c) => ({
    user_id: deps.userId,
    emergency_id: emergency.id,
    contact_id: c.id,
    contact_name: c.name,
    contact_email: c.email!.trim().toLowerCase(),
    channel: "email",
    status: "pending",
    kind: deps.kind,
    dedupe_key: `${emergency.id}:${c.id}:${deps.kind}:email`,
  }));
  // Unique dedupe_key: concurrent/repeated requests only claim rows once.
  const { data: claimed, error: iErr } = await deps.adminDb
    .from("emergency_alert_deliveries")
    .upsert(rows, { onConflict: "dedupe_key", ignoreDuplicates: true })
    .select("id,contact_id,contact_name,contact_email");
  if (iErr) throw new Error("Could not record email notifications.");
  const claimedIds = new Set((claimed ?? []).map((r) => r.contact_id));
  const outcomes: EmailOutcome[] = targets
    .filter((t) => !claimedIds.has(t.id))
    .map((t) => ({ deliveryId: "", contactId: t.id, name: t.name, status: "duplicate" }));

  const settled = await Promise.allSettled(
    (claimed ?? []).map(async (row) => {
      let result: ProviderResult;
      try {
        result = await send({
          to: row.contact_email!,
          subject: content.subject,
          html: content.html,
          text: content.text,
          idempotencyKey: row.id,
        });
      } catch {
        result = { ok: false, category: "provider_error", error: "Email provider request failed." };
      }
      const now = new Date().toISOString();
      const { error } = await deps.adminDb
        .from("emergency_alert_deliveries")
        .update(
          result.ok
            ? {
                status: "sent",
                sent_at: now,
                provider_message_id: result.providerMessageId,
                error: null,
              }
            : { status: "failed", failed_at: now, error: result.error },
        )
        .eq("id", row.id);
      if (error)
        console.error("[email] status update failed", { deliveryId: row.id, code: error.code });
      console.info("[email]", {
        emergencyId: emergency.id,
        deliveryId: row.id,
        contactId: row.contact_id,
        status: result.ok ? "sent" : "failed",
        category: result.ok ? undefined : result.category,
      });
      return {
        deliveryId: row.id,
        contactId: row.contact_id!,
        name: row.contact_name,
        status: result.ok ? "sent" : "failed",
        error: result.ok ? undefined : result.error,
      } as EmailOutcome;
    }),
  );
  for (const s of settled) if (s.status === "fulfilled") outcomes.push(s.value);
  return { skipped: false, outcomes };
}
