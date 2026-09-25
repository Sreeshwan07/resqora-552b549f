import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import {
  AlertTriangle,
  CheckCircle2,
  Clock,
  Loader2,
  MapPinned,
  MessageCircle,
  Navigation,
  Pause,
  Siren,
  WifiOff,
  X,
} from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { MapPreview } from "@/components/resqora/map-preview";
import { ConfirmModal } from "@/components/system/confirm-modal";
import { JourneyStatusBadge } from "@/components/journey/journey-status-badge";
import { useAuth } from "@/hooks/use-auth";
import type { SafeJourneyMonitor } from "@/hooks/use-safe-journey";
import { mapsDirectionsLink } from "@/lib/alerts";
import {
  journeyEventsQuery,
  journeyWhatsappLink,
  notifyJourneyEvent,
  statusMeta,
  trackJourneyEvent,
  transitionJourney,
  type SafeJourney,
} from "@/lib/safe-journey";

/** The live journey dashboard. Every action calls the server state machine. */
export function ActiveJourneyPanel({ monitor }: { monitor: SafeJourneyMonitor }) {
  const journey = monitor.journey as SafeJourney;
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const events = useQuery(journeyEventsQuery(journey.id));
  const [busy, setBusy] = useState<string | null>(null);
  const [confirmEnd, setConfirmEnd] = useState(false);

  const meta = statusMeta(journey.status);
  const coords =
    journey.last_latitude != null && journey.last_longitude != null
      ? { lat: journey.last_latitude, lng: journey.last_longitude }
      : monitor.position
        ? { lat: monitor.position.lat, lng: monitor.position.lng }
        : null;

  const run = async (
    key: string,
    work: () => Promise<void>,
    success?: string,
  ) => {
    setBusy(key);
    try {
      await work();
      await queryClient.invalidateQueries({ queryKey: ["safe-journey-active", user?.id] });
      await queryClient.invalidateQueries({ queryKey: ["safe-journey-history", user?.id] });
      await queryClient.invalidateQueries({ queryKey: ["safe-journey-events", journey.id] });
      if (success) toast.success(success);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not update the journey");
    } finally {
      setBusy(null);
    }
  };

  const markSafe = () =>
    run(
      "safe",
      async () => {
        const completed = await transitionJourney(
          journey.id,
          "completed",
          "Marked safe by the traveller",
        );
        trackJourneyEvent(user?.id, "journey_completed");
        const outcomes = await notifyJourneyEvent({
          journey: completed,
          event: "JOURNEY_COMPLETED",
          profile: monitor.profile,
          guardian: true,
        });
        const email = outcomes.find((o) => o.channel === "email");
        if (email && email.status !== "sent") toast.warning(email.detail);
      },
      "Journey marked safe. Location tracking has stopped.",
    );

  const whatsapp = journeyWhatsappLink(
    journey,
    journey.status === "completed" ? "JOURNEY_COMPLETED" : "GUARDIAN_NOTIFIED",
    monitor.profile,
  );

  const needsCheckIn = journey.status === "check_in_required";
  const missed = journey.status === "check_in_missed" || journey.status === "guardian_notified";

  return (
    <div className="space-y-4">
      <section className="overflow-hidden rounded-2xl border border-border bg-card">
        <header className="flex flex-wrap items-start justify-between gap-3 border-b border-border p-4 sm:p-5">
          <div className="min-w-0">
            <p className="text-xs font-semibold uppercase tracking-wide text-info">
              Safe Journey active
            </p>
            <h2 className="mt-1 truncate text-lg font-semibold text-foreground">{journey.name}</h2>
            <p className="mt-1 truncate text-sm text-muted-foreground">
              {journey.origin_address ?? "Start point"} → {journey.destination_address}
            </p>
          </div>
          <div className="flex flex-col items-end gap-2">
            <JourneyStatusBadge status={journey.status} />
            <span className="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
              {monitor.online ? (
                <Navigation className="size-3.5" aria-hidden="true" />
              ) : (
                <WifiOff className="size-3.5" aria-hidden="true" />
              )}
              {monitor.freshness.label}
            </span>
          </div>
        </header>

        <dl className="grid gap-4 p-4 sm:grid-cols-3 sm:p-5">
          <div>
            <dt className="text-xs text-muted-foreground">Expected arrival</dt>
            <dd className="text-sm font-medium text-foreground">
              {new Date(journey.expected_arrival_at).toLocaleString()}
            </dd>
          </div>
          <div>
            <dt className="text-xs text-muted-foreground">Distance to destination</dt>
            <dd className="text-sm font-medium text-foreground">
              {monitor.distanceKm != null ? `${monitor.distanceKm.toFixed(1)} km` : "Not available"}
            </dd>
          </div>
          <div>
            <dt className="text-xs text-muted-foreground">Guardian</dt>
            <dd className="text-sm font-medium text-foreground">
              {journey.guardian_name}
              <span className="block text-xs font-normal text-muted-foreground">
                {journey.guardian_notified_at
                  ? `Alerted ${new Date(journey.guardian_notified_at).toLocaleTimeString()}`
                  : "Not alerted"}
              </span>
            </dd>
          </div>
        </dl>

        <MapPreview
          coords={coords}
          title="Safe Journey location"
          className="h-56 sm:h-72"
        />
        <p className="border-t border-border px-4 py-2 text-xs text-muted-foreground">
          {journey.last_location_at
            ? `Location last updated ${new Date(journey.last_location_at).toLocaleTimeString()} · ${monitor.freshness.label}`
            : "No location update stored yet."}
          {!monitor.online && " · Connection lost — showing last known location."}
        </p>
      </section>

      {needsCheckIn && (
        <section className="rounded-2xl border border-warning/50 bg-warning/10 p-4 sm:p-5">
          <p className="flex items-center gap-2 text-sm font-semibold text-warning">
            <Clock className="size-4" aria-hidden="true" />
            Are you safe?
          </p>
          <p className="mt-1 text-sm text-muted-foreground">
            Your Safe Journey has reached its check-in time. Your guardian is alerted only if you do
            not respond within {journey.grace_period_minutes} minutes.
          </p>
          <div className="mt-4 grid gap-2 sm:grid-cols-3">
            <Button
              className="min-h-11"
              disabled={busy !== null}
              onClick={() => void markSafe()}
            >
              <CheckCircle2 className="size-4" aria-hidden="true" />
              I'm safe
            </Button>
            <Button
              variant="outline"
              className="min-h-11"
              disabled={busy !== null}
              onClick={() =>
                void run(
                  "travelling",
                  async () => {
                    await transitionJourney(journey.id, "active", "Still travelling");
                    trackJourneyEvent(user?.id, "check_in_completed");
                  },
                  "Check-in recorded — still travelling.",
                )
              }
            >
              <Navigation className="size-4" aria-hidden="true" />
              Still travelling
            </Button>
            <Button asChild variant="destructive" className="min-h-11">
              <Link to="/emergency" search={{ auto: true }}>
                <Siren className="size-4" aria-hidden="true" />
                Need help
              </Link>
            </Button>
          </div>
        </section>
      )}

      {journey.status === "arriving" && (
        <section className="rounded-2xl border border-info/40 bg-info/10 p-4 sm:p-5">
          <p className="flex items-center gap-2 text-sm font-semibold text-info">
            <MapPinned className="size-4" aria-hidden="true" />
            You appear to have reached your destination.
          </p>
          <p className="mt-1 text-sm text-muted-foreground">
            RESQORA never closes a journey for you — please confirm.
          </p>
          <div className="mt-4 grid gap-2 sm:grid-cols-2">
            <Button className="min-h-11" disabled={busy !== null} onClick={() => void markSafe()}>
              <CheckCircle2 className="size-4" aria-hidden="true" />
              I'm safe
            </Button>
            <Button
              variant="outline"
              className="min-h-11"
              disabled={busy !== null}
              onClick={() =>
                void run(
                  "still",
                  () => transitionJourney(journey.id, "active", "Still travelling").then(() => {}),
                  "Still monitoring your journey.",
                )
              }
            >
              Still travelling
            </Button>
          </div>
        </section>
      )}

      {missed && (
        <section className="rounded-2xl border border-alert/50 bg-alert/10 p-4 sm:p-5">
          <p className="flex items-center gap-2 text-sm font-semibold text-alert">
            <AlertTriangle className="size-4" aria-hidden="true" />
            Check-in missed
          </p>
          <p className="mt-1 text-sm text-muted-foreground">
            No confirmation has been received. {journey.guardian_name} has been told that — nothing
            more. Confirm you are safe, or open an emergency if you need help.
          </p>
          <div className="mt-4 grid gap-2 sm:grid-cols-2">
            <Button className="min-h-11" disabled={busy !== null} onClick={() => void markSafe()}>
              <CheckCircle2 className="size-4" aria-hidden="true" />
              I'm safe
            </Button>
            <Button asChild variant="destructive" className="min-h-11">
              <Link to="/emergency" search={{ auto: true }}>
                <Siren className="size-4" aria-hidden="true" />
                Need help
              </Link>
            </Button>
          </div>
        </section>
      )}

      <section className="rounded-2xl border border-border bg-card p-4 sm:p-5">
        <h3 className="text-sm font-semibold text-foreground">Journey controls</h3>
        <p className="mt-1 text-xs text-muted-foreground">{meta.detail}</p>
        <div className="mt-4 grid gap-2 sm:grid-cols-3">
          <Button
            size="lg"
            className="min-h-12 bg-success text-success-foreground hover:opacity-95"
            disabled={busy !== null}
            onClick={() => void markSafe()}
          >
            {busy === "safe" ? (
              <Loader2 className="size-4 animate-spin" aria-hidden="true" />
            ) : (
              <CheckCircle2 className="size-4" aria-hidden="true" />
            )}
            I'm safe
          </Button>
          <Button
            size="lg"
            variant="outline"
            className="min-h-12"
            disabled={busy !== null || journey.status !== "active"}
            onClick={() =>
              void run(
                "pause",
                () =>
                  transitionJourney(
                    journey.id,
                    "check_in_required",
                    "Paused by the traveller",
                  ).then(() => {}),
                "Journey paused — confirm when you continue.",
              )
            }
          >
            <Pause className="size-4" aria-hidden="true" />
            Pause journey
          </Button>
          <Button
            size="lg"
            variant="outline"
            className="min-h-12"
            disabled={busy !== null}
            onClick={() => setConfirmEnd(true)}
          >
            <X className="size-4" aria-hidden="true" />
            End journey
          </Button>
        </div>
        {whatsapp.href && (
          <Button asChild variant="ghost" size="sm" className="mt-3">
            <a href={whatsapp.href} target="_blank" rel="noreferrer">
              <MessageCircle className="size-4" aria-hidden="true" />
              Send {journey.guardian_name} a WhatsApp update
            </a>
          </Button>
        )}
        {coords && (
          <Button asChild variant="ghost" size="sm" className="mt-3">
            <a
              href={mapsDirectionsLink(coords, {
                lat: journey.destination_latitude ?? coords.lat,
                lng: journey.destination_longitude ?? coords.lng,
              })}
              target="_blank"
              rel="noreferrer"
            >
              <Navigation className="size-4" aria-hidden="true" />
              Open directions
            </a>
          </Button>
        )}
      </section>

      <section className="rounded-2xl border border-border bg-card p-4 sm:p-5">
        <h3 className="text-sm font-semibold text-foreground">Journey timeline</h3>
        <ol className="mt-3 space-y-3">
          {(events.data ?? []).map((event) => (
            <li key={event.id} className="flex gap-3 text-sm">
              <span className="mt-1.5 size-2 shrink-0 rounded-full bg-primary" aria-hidden="true" />
              <div className="min-w-0">
                <p className="font-medium text-foreground">{event.label}</p>
                {event.detail && <p className="text-xs text-muted-foreground">{event.detail}</p>}
                <p className="text-xs text-muted-foreground">
                  {new Date(event.created_at).toLocaleString()}
                </p>
              </div>
            </li>
          ))}
          {(events.data ?? []).length === 0 && (
            <li className="text-sm text-muted-foreground">No journey events recorded yet.</li>
          )}
        </ol>
      </section>

      <ConfirmModal
        open={confirmEnd}
        onOpenChange={setConfirmEnd}
        title="End this Safe Journey?"
        description="Monitoring and location sharing stop immediately. Your guardian is told the journey was cancelled."
        confirmLabel="End journey"
        onConfirm={() => {
          setConfirmEnd(false);
          void run(
            "cancel",
            async () => {
              const cancelled = await transitionJourney(
                journey.id,
                "cancelled",
                "Cancelled by the traveller",
              );
              trackJourneyEvent(user?.id, "journey_cancelled");
              await notifyJourneyEvent({
                journey: cancelled,
                event: "JOURNEY_CANCELLED",
                profile: monitor.profile,
                guardian: true,
              });
            },
            "Journey ended.",
          );
        }}
      />
    </div>
  );
}
