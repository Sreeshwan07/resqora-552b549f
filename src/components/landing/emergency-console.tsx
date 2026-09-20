import { useState } from "react";
import { Link, useNavigate } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, Camera, CheckCircle2, Loader2, ShieldCheck, Siren } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/hooks/use-auth";
import { activeEmergencyQuery, contactsQuery, profileQuery } from "@/lib/api";
import { confirmSafe, createEmergency, type NotificationOutcome } from "@/lib/emergency";
import { cn } from "@/lib/utils";

const CHANNEL_LABELS: Record<NotificationOutcome["channel"], string> = {
  email: "Email alerts",
  sms: "SMS alerts",
  whatsapp: "WhatsApp alerts",
  guardian: "Guardian alert",
};

const OUTCOME_STYLES: Record<NotificationOutcome["status"], string> = {
  sent: "text-success",
  ready: "text-info",
  unavailable: "text-warning",
  skipped: "text-muted-foreground",
  failed: "text-alert",
};

export function EmergencyConsole({ mode = "full" }: { mode?: "full" | "report" }) {
  const navigate = useNavigate();
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const contacts = useQuery(contactsQuery(user?.id));
  const profile = useQuery(profileQuery(user?.id));
  const active = useQuery(activeEmergencyQuery(user?.id));

  const emergency = active.data ?? null;
  const sosActive = Boolean(
    emergency && emergency.status !== "resolved" && emergency.status !== "cancelled",
  );

  const [sosBusy, setSosBusy] = useState(false);
  const [report, setReport] = useState<NotificationOutcome[] | null>(null);

  /** One tap: create the session, capture GPS, start tracking and notify. */
  async function triggerSos() {
    if (!user) {
      await navigate({ to: "/auth" });
      return;
    }
    setSosBusy(true);
    setReport(null);
    try {
      const created = await createEmergency({
        userId: user.id,
        type: "sos",
        severity: "high",
        contactCount: contacts.data?.length ?? 0,
        contacts: contacts.data ?? [],
        profile: profile.data ?? null,
      });
      setReport(created.notifications);
      await queryClient.invalidateQueries();
      const sent = created.notifications.filter((n) => n.status === "sent").length;
      if (sent > 0) toast.success("SOS active — your contacts have been notified");
      else toast.warning("SOS active — no automatic channel delivered, see the status below");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not send the SOS");
    } finally {
      setSosBusy(false);
    }
  }

  /** Cancel SOS: stops tracking, closes the session, tells contacts you're safe. */
  async function cancelSos() {
    if (!emergency) return;
    setSosBusy(true);
    try {
      await confirmSafe({
        emergency,
        profile: profile.data,
        contacts: contacts.data ?? [],
      });
      setReport(null);
      await queryClient.invalidateQueries();
      toast.success("Emergency resolved — your contacts know you're safe");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not cancel the SOS");
    } finally {
      setSosBusy(false);
    }
  }

  return (
    <section aria-label="Emergency actions" className="soft-card h-full space-y-3 rounded-2xl p-4 sm:p-5">
      <div className="flex items-center justify-between gap-3 px-1">
        <div>
          <h2 className="font-display text-base font-extrabold text-foreground">Get emergency help</h2>
          <p className="mt-0.5 text-xs text-muted-foreground">Choose the fastest action for your situation.</p>
        </div>
        <span className="size-2.5 shrink-0 rounded-full bg-success" aria-label="Emergency system ready" />
      </div>
      <div className="grid gap-3">
        {mode === "full" &&
          (sosActive ? (
            <Button
              size="xl"
              disabled={sosBusy}
              onClick={cancelSos}
              className="h-20 rounded-xl bg-success text-base font-bold text-success-foreground shadow-lg shadow-success/20 hover:bg-success/90 sm:h-24 sm:text-lg"
            >
              {sosBusy ? (
                <Loader2 className="size-6 animate-spin" aria-hidden="true" />
              ) : (
                <ShieldCheck className="size-6" aria-hidden="true" />
              )}
              Cancel SOS — I'm safe
            </Button>
          ) : (
            <Button
              size="xl"
              disabled={sosBusy}
              className="h-20 rounded-xl bg-alert text-base font-bold text-alert-foreground shadow-lg shadow-alert/25 transition-transform hover:bg-alert/90 active:scale-[0.98] sm:h-24 sm:text-lg"
              onClick={triggerSos}
            >
              {sosBusy ? (
                <Loader2 className="size-6 animate-spin" aria-hidden="true" />
              ) : (
                <Siren className="size-6" aria-hidden="true" />
              )}
              Emergency SOS
            </Button>
          ))}

        <Button
          asChild
          size="xl"
          variant="outline"
          className="h-12 rounded-xl border-border bg-background text-sm font-bold text-foreground hover:bg-secondary"
        >
          <Link to="/report">
            <Camera className="size-6" aria-hidden="true" />
            Report Accident
          </Link>
        </Button>
      </div>

      {sosBusy && !sosActive && (
        <div className="space-y-2 rounded-2xl border border-alert/40 bg-alert/5 p-4">
          <p className="text-sm font-semibold text-foreground">Activating emergency response…</p>
          <ul className="space-y-1 text-xs text-muted-foreground">
            <li>• Creating the emergency session</li>
            <li>• Capturing GPS location and address</li>
            <li>• Starting live location tracking</li>
            <li>• Notifying your trusted contacts</li>
          </ul>
          <div className="h-1.5 overflow-hidden rounded-full bg-muted">
            <div className="h-full w-1/2 animate-pulse rounded-full bg-alert" />
          </div>
        </div>
      )}

      {report && report.length > 0 && (
        <div className="rounded-2xl border border-border/60 bg-card/70 p-4">
          <h2 className="text-sm font-semibold text-foreground">Notification results</h2>
          <ul className="mt-2 space-y-1.5 text-xs">
            {report.map((item) => (
              <li key={item.channel} className="flex items-start gap-2">
                {item.status === "sent" || item.status === "ready" ? (
                  <CheckCircle2
                    className={cn("mt-0.5 size-3.5 shrink-0", OUTCOME_STYLES[item.status])}
                    aria-hidden="true"
                  />
                ) : (
                  <AlertTriangle
                    className={cn("mt-0.5 size-3.5 shrink-0", OUTCOME_STYLES[item.status])}
                    aria-hidden="true"
                  />
                )}
                <span className="min-w-0">
                  <span className="font-medium text-foreground">
                    {CHANNEL_LABELS[item.channel]}:
                  </span>{" "}
                  <span className={OUTCOME_STYLES[item.status]}>{item.detail}</span>
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}
