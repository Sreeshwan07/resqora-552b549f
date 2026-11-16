import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Check,
  Loader2,
  Mail,
  MessageCircle,
  MessageSquare,
  RefreshCcw,
  Send,
  X,
} from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { EmptyState } from "@/components/system/empty-state";
import type { Emergency, EmergencyContact, Profile } from "@/lib/api";
import {
  buildEmergencyAlert,
  deliveriesQuery,
  dispatchDeliveries,
  markDelivery,
  seedDeliveries,
  type AlertDelivery,
} from "@/lib/alert-delivery";
import { emailHref, smsHref, whatsappHref } from "@/lib/share";

/**
 * Delivery board for the three trusted contacts. Automatic SMS is attempted
 * through the connected provider; when none is connected each contact can be
 * reached in one tap over WhatsApp, SMS or email and the outcome is recorded.
 */
export function ContactAlertStatus({
  emergency,
  profile,
  contacts,
  trackingUrl,
  address,
}: {
  emergency: Emergency;
  profile: Profile | null | undefined;
  contacts: EmergencyContact[];
  trackingUrl?: string | null;
  address?: string | null;
}) {
  const queryClient = useQueryClient();
  const deliveries = useQuery(deliveriesQuery(emergency.id));
  const [busy, setBusy] = useState(false);

  const message = buildEmergencyAlert({ emergency, profile, address, trackingUrl });
  const rows = (deliveries.data ?? []).filter((row) => row.kind === "alert");

  async function refresh() {
    await queryClient.invalidateQueries({ queryKey: ["alert-deliveries", emergency.id] });
  }

  async function retryAll() {
    setBusy(true);
    try {
      let current = rows;
      if (current.length === 0) {
        current = await seedDeliveries({
          userId: emergency.user_id,
          emergencyId: emergency.id,
          contacts,
        });
      }
      const automatic = await dispatchDeliveries({
        emergencyId: emergency.id,
        kind: "alert",
        contactIds: contacts.map((contact) => contact.id),
        trackingUrl,
        address,
      });
      await refresh();
      const accepted = automatic.results.filter(
        (result) => result.status === "sent" || result.status === "delivered",
      ).length;
      toast[accepted > 0 ? "success" : "message"](
        accepted > 0
          ? `${accepted} alert${accepted === 1 ? "" : "s"} accepted by the SMS provider`
          : automatic.configured
            ? "No new alerts were sent — check each delivery status below"
            : "No SMS provider connected — send each alert with the buttons below",
      );
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not send alerts");
    } finally {
      setBusy(false);
    }
  }

  async function confirmSent(row: AlertDelivery, channel: string) {
    try {
      await markDelivery(row.id, "delivered", { channel });
      await refresh();
    } catch {
      /* keep the UI responsive — the periodic refetch will correct the state */
    }
  }

  async function markFailed(row: AlertDelivery) {
    await markDelivery(row.id, "failed", { channel: row.channel, error: "Could not be reached" });
    await refresh();
  }

  if (contacts.length === 0) {
    return (
      <EmptyState
        icon={Send}
        title="No trusted contacts yet"
        description="Add three emergency contacts in your profile so RESQORA can alert them instantly."
      />
    );
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-xs text-muted-foreground">
          {rows.filter((r) => r.status === "delivered").length} of {rows.length || contacts.length}{" "}
          contacts confirmed delivered.
        </p>
        <Button size="sm" variant="outline" onClick={retryAll} disabled={busy}>
          {busy ? <Loader2 className="size-4 animate-spin" /> : <RefreshCcw className="size-4" />}
          Resend all
        </Button>
      </div>

      <ul className="space-y-3">
        {rows.map((row) => {
          const phone = row.contact_phone;
          return (
            <li key={row.id} className="rounded-2xl border border-border bg-card/60 p-4">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="truncate text-sm font-semibold text-foreground">
                    {row.contact_name}
                  </p>
                  <p className="truncate text-xs text-muted-foreground">
                    {phone ?? "No phone"}
                    {row.sent_at ? ` · ${new Date(row.sent_at).toLocaleTimeString()}` : ""}
                  </p>
                </div>
                <DeliveryBadge status={row.status} error={row.error} />
              </div>

              <div className="mt-3 flex flex-wrap gap-2">
                <Button
                  size="sm"
                  variant="hero"
                  asChild
                  onClick={() => confirmSent(row, "whatsapp")}
                >
                  <a href={whatsappHref(message, phone)} target="_blank" rel="noreferrer">
                    <MessageCircle className="size-4" />
                    WhatsApp
                  </a>
                </Button>
                <Button size="sm" variant="outline" asChild onClick={() => confirmSent(row, "sms")}>
                  <a href={smsHref(message, phone)}>
                    <MessageSquare className="size-4" />
                    SMS
                  </a>
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  asChild
                  onClick={() => confirmSent(row, "email")}
                >
                  <a href={emailHref(message)}>
                    <Mail className="size-4" />
                    Email
                  </a>
                </Button>
                {row.status !== "failed" && (
                  <Button size="sm" variant="ghost" onClick={() => markFailed(row)}>
                    <X className="size-4" />
                    Couldn't reach
                  </Button>
                )}
              </div>
            </li>
          );
        })}
        {rows.length === 0 && (
          <li className="rounded-2xl border border-dashed border-border p-4 text-sm text-muted-foreground">
            Preparing contact alerts…
          </li>
        )}
      </ul>

      <details className="rounded-2xl border border-border bg-card/60 p-4">
        <summary className="cursor-pointer text-xs font-medium text-primary">
          Preview the alert
        </summary>
        <pre className="mt-3 max-h-56 overflow-auto whitespace-pre-wrap text-xs leading-relaxed text-foreground">
          {message}
        </pre>
      </details>
    </div>
  );
}

function DeliveryBadge({ status, error }: { status: string; error: string | null }) {
  if (status === "delivered") {
    return (
      <Badge className="gap-1 rounded-full bg-success/15 text-[10px] font-semibold text-success">
        <Check className="size-3" aria-hidden="true" />
        Delivered
      </Badge>
    );
  }
  if (status === "failed") {
    return (
      <Badge className="gap-1 rounded-full bg-alert/15 text-[10px] font-semibold text-alert">
        <X className="size-3" aria-hidden="true" />
        {error || "Failed"}
      </Badge>
    );
  }
  return (
    <Badge variant="outline" className="gap-1 rounded-full text-[10px] font-semibold">
      <Loader2 className="size-3 animate-spin" aria-hidden="true" />
      Sending
    </Badge>
  );
}
