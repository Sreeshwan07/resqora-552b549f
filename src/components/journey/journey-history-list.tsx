import { useQuery } from "@tanstack/react-query";
import { History } from "lucide-react";
import { EmptyState } from "@/components/system/empty-state";
import { JourneyStatusBadge } from "@/components/journey/journey-status-badge";
import { useAuth } from "@/hooks/use-auth";
import { isLive, journeyHistoryQuery } from "@/lib/safe-journey";

/** Past journeys only — the minimum needed to recognise a trip, no location trail. */
export function JourneyHistoryList() {
  const { user } = useAuth();
  const journeys = useQuery(journeyHistoryQuery(user?.id));
  const past = (journeys.data ?? []).filter((journey) => !isLive(journey));

  if (past.length === 0) {
    return (
      <EmptyState
        icon={History}
        title="No journeys yet"
        description="Completed and cancelled Safe Journeys will appear here."
      />
    );
  }

  return (
    <ul className="divide-y divide-border overflow-hidden rounded-2xl border border-border bg-card">
      {past.map((journey) => (
        <li key={journey.id} className="flex flex-wrap items-center justify-between gap-3 p-4">
          <div className="min-w-0">
            <p className="truncate text-sm font-semibold text-foreground">{journey.name}</p>
            <p className="truncate text-xs text-muted-foreground">{journey.destination_address}</p>
            <p className="mt-1 text-xs text-muted-foreground">
              {new Date(journey.started_at ?? journey.created_at).toLocaleString()}
              {journey.completed_at
                ? ` → ${new Date(journey.completed_at).toLocaleTimeString()}`
                : journey.cancelled_at
                  ? ` → cancelled ${new Date(journey.cancelled_at).toLocaleTimeString()}`
                  : ""}
            </p>
          </div>
          <JourneyStatusBadge status={journey.status} />
        </li>
      ))}
    </ul>
  );
}
