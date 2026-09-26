import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { MapPinned, Phone, Siren, Users } from "lucide-react";
import { Button } from "@/components/ui/button";
import { JourneyStatusBadge } from "@/components/journey/journey-status-badge";
import { useAuth } from "@/hooks/use-auth";
import { useRealtimeTables } from "@/hooks/use-realtime-tables";
import { mapsLink } from "@/lib/alerts";
import { dialHref } from "@/lib/validation";
import { guardianJourneysQuery } from "@/lib/safe-journey";

/**
 * Journeys explicitly shared with the signed-in guardian. The database function
 * decides what is visible — this card only renders what it returns.
 */
export function GuardianJourneysCard() {
  const { user } = useAuth();
  const journeys = useQuery(guardianJourneysQuery(user?.id));

  useRealtimeTables({
    channel: user ? `guardian-journeys-${user.id}` : null,
    watch: [{ table: "safe_journeys" }],
    invalidate: [["guardian-journeys", user?.id]],
  });

  const rows = journeys.data ?? [];
  if (rows.length === 0) return null;

  return (
    <section className="rounded-2xl border border-info/40 bg-info/5 p-4 sm:p-5">
      <h2 className="flex items-center gap-2 text-sm font-semibold text-foreground">
        <Users className="size-4 text-info" aria-hidden="true" />
        Active Safe Journeys shared with you
      </h2>
      <ul className="mt-3 space-y-3">
        {rows.map((row) => (
          <li key={row.journey_id} className="rounded-xl border border-border bg-card p-3">
            <div className="flex flex-wrap items-start justify-between gap-2">
              <div className="min-w-0">
                <p className="truncate text-sm font-semibold text-foreground">
                  {row.traveller_name ?? "RESQORA user"} · {row.journey_name}
                </p>
                <p className="truncate text-xs text-muted-foreground">
                  To {row.destination_address}
                </p>
                <p className="mt-1 text-xs text-muted-foreground">
                  Expected {new Date(row.expected_arrival_at).toLocaleString()}
                  {row.last_location_at
                    ? ` · location updated ${new Date(row.last_location_at).toLocaleTimeString()}`
                    : " · no location shared"}
                </p>
              </div>
              <JourneyStatusBadge status={row.status} />
            </div>
            <div className="mt-3 flex flex-wrap gap-2">
              {row.last_latitude != null && row.last_longitude != null && (
                <Button asChild size="sm" variant="outline" className="min-h-10">
                  <a
                    href={mapsLink({ lat: row.last_latitude, lng: row.last_longitude })}
                    target="_blank"
                    rel="noreferrer"
                  >
                    <MapPinned className="size-4" aria-hidden="true" />
                    View location
                  </a>
                </Button>
              )}
              {row.traveller_phone && (
                <Button asChild size="sm" variant="outline" className="min-h-10">
                  <a href={dialHref(row.traveller_phone)}>
                    <Phone className="size-4" aria-hidden="true" />
                    Contact user
                  </a>
                </Button>
              )}
              {row.emergency_id && (
                <Button asChild size="sm" variant="destructive" className="min-h-10">
                  <Link to="/live">
                    <Siren className="size-4" aria-hidden="true" />
                    Open emergency session
                  </Link>
                </Button>
              )}
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}
