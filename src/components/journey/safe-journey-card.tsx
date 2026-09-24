import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { AlertTriangle, MapPinned, Route } from "lucide-react";
import { Button } from "@/components/ui/button";
import { JourneyStatusBadge } from "@/components/journey/journey-status-badge";
import { useAuth } from "@/hooks/use-auth";
import { activeJourneyQuery, statusMeta } from "@/lib/safe-journey";

/**
 * Home-screen Safe Journey card. Three honest states: nothing running, a live
 * journey, or a journey waiting for the user to confirm they are safe.
 */
export function SafeJourneyCard() {
  const { user } = useAuth();
  const journey = useQuery(activeJourneyQuery(user?.id));
  const data = journey.data;

  if (!user) return null;

  if (!data) {
    return (
      <section
        aria-labelledby="safe-journey-idle"
        className="rounded-2xl border border-border bg-card p-4 sm:p-5"
      >
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex min-w-0 items-center gap-3">
            <span className="grid size-11 shrink-0 place-items-center rounded-xl bg-info/10 text-info">
              <Route className="size-5" aria-hidden="true" />
            </span>
            <div className="min-w-0">
              <h2 id="safe-journey-idle" className="text-base font-semibold text-foreground">
                Where are you going?
              </h2>
              <p className="text-sm text-muted-foreground">
                Let a trusted contact know you arrived safely.
              </p>
            </div>
          </div>
          <Button asChild size="lg" className="min-h-11 w-full sm:w-auto">
            <Link to="/journey">Start Safe Journey</Link>
          </Button>
        </div>
      </section>
    );
  }

  const attention = ["check_in_required", "check_in_missed", "guardian_notified"].includes(
    data.status,
  );
  const meta = statusMeta(data.status);

  return (
    <section
      aria-labelledby="safe-journey-active"
      className={`rounded-2xl border p-4 sm:p-5 ${
        attention ? "border-warning/50 bg-warning/5" : "border-info/40 bg-info/5"
      }`}
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            {attention ? (
              <span className="inline-flex items-center gap-1.5 text-sm font-semibold text-warning">
                <AlertTriangle className="size-4" aria-hidden="true" />
                {data.status === "check_in_required" ? "Check-in required" : "Check-in missed"}
              </span>
            ) : (
              <h2 id="safe-journey-active" className="text-sm font-semibold text-info">
                Safe Journey active
              </h2>
            )}
            <JourneyStatusBadge status={data.status} />
          </div>
          <p className="mt-2 truncate text-base font-semibold text-foreground">{data.name}</p>
          <p className="mt-1 flex items-center gap-1.5 truncate text-sm text-muted-foreground">
            <MapPinned className="size-4 shrink-0" aria-hidden="true" />
            {data.destination_address}
          </p>
          <p className="mt-1 text-xs text-muted-foreground">
            Expected arrival {new Date(data.expected_arrival_at).toLocaleString()} · {meta.detail}
          </p>
        </div>
        <Button
          asChild
          size="lg"
          variant={attention ? "default" : "outline"}
          className="min-h-11 w-full sm:w-auto"
        >
          <Link to="/journey">{attention ? "Respond now" : "Open journey"}</Link>
        </Button>
      </div>
    </section>
  );
}
