import { Link } from "@tanstack/react-router";
import { motion } from "motion/react";
import { ChevronRight, MapPin, Navigation, PhoneCall, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { mapsClickHandler, mapsHref } from "@/lib/maps";
import type { PlaceCategory } from "@/lib/nearby.server";
import type { useNearbyServices } from "@/hooks/use-nearby-services";
import { CATEGORY_ICON } from "@/components/resqora/nearest-services";
import { cn } from "@/lib/utils";

const ROWS: { category: PlaceCategory; label: string; tel: string }[] = [
  { category: "hospital", label: "Hospital", tel: "108" },
  { category: "police", label: "Police Station", tel: "112" },
  { category: "fire", label: "Fire Station", tel: "101" },
  { category: "blood_bank", label: "Blood Bank", tel: "108" },
];

/** Four compact responder cards: name, distance, ETA and one-tap actions. */
export function CompactNearestServices({
  nearby,
}: {
  nearby: ReturnType<typeof useNearbyServices>;
}) {
  return (
    <section aria-label="Nearest emergency services" className="space-y-3">
      <div className="flex items-center justify-between gap-2">
        <h2 className="font-display text-lg font-extrabold text-foreground sm:text-xl">
          Nearest Emergency Services
        </h2>
        <div className="flex shrink-0 items-center gap-1">
          <Button
            size="icon"
            variant="ghost"
            aria-label="Refresh nearby services"
            disabled={!nearby.origin || nearby.isFetching}
            onClick={() => void nearby.refresh()}
          >
            <RefreshCw className={cn("size-4", nearby.isFetching && "animate-spin")} />
          </Button>
          <Button asChild variant="ghost" size="sm" className="h-9 rounded-lg text-xs font-bold">
            <Link to="/nearby">
              View all <ChevronRight className="size-3.5" />
            </Link>
          </Button>
        </div>
      </div>

      <ul className="grid gap-3 sm:grid-cols-2 sm:gap-4">
        {ROWS.map((row, index) => {
          const place = [...nearby.data[row.category]].sort(
            (a, b) => a.distanceKm - b.distanceKm,
          )[0];
          const Icon = CATEGORY_ICON[row.category];
          if (!place) {
            return (
              <li key={row.category}>
                {nearby.isLoading ? (
                  <Skeleton className="h-20 w-full rounded-2xl" />
                ) : (
                  <div className="soft-card flex h-full min-h-20 items-center gap-3 rounded-2xl p-3.5">
                    <span
                      aria-hidden="true"
                      className="grid size-10 shrink-0 place-items-center rounded-xl bg-teal/10 text-teal"
                    >
                      <Icon className="size-5" />
                    </span>
                    <div className="min-w-0 flex-1">
                      <p className="font-display text-sm font-bold text-foreground">{row.label}</p>
                      <p className="text-xs text-muted-foreground">No nearby result yet</p>
                    </div>
                    <Button
                      asChild
                      size="icon"
                      className="size-11 shrink-0 rounded-xl bg-alert text-alert-foreground hover:bg-alert/90"
                    >
                      <a href={`tel:${row.tel}`} aria-label={`Call ${row.tel}`}>
                        <PhoneCall className="size-4" />
                      </a>
                    </Button>
                  </div>
                )}
              </li>
            );
          }
          const tel = place.phone ? place.phone.replace(/[^+\d]/g, "") : row.tel;
          return (
            <motion.li
              key={row.category}
              initial={{ opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.2, delay: index * 0.04 }}
              className="soft-card rounded-2xl p-4"
            >
              <div className="flex min-w-0 items-center gap-3">
                <span
                  aria-hidden="true"
                  className="grid size-11 shrink-0 place-items-center rounded-xl bg-teal/10 text-teal"
                >
                  <Icon className="size-5" />
                </span>
                <div className="min-w-0 flex-1">
                  <p className="text-[11px] font-semibold uppercase text-muted-foreground">
                    {row.label}
                  </p>
                  <p className="truncate font-display text-sm font-bold text-foreground sm:text-base">
                    {place.name}
                  </p>
                  <p className="mt-0.5 text-xs font-semibold text-muted-foreground">
                    {place.distanceKm.toFixed(1)} km · ETA ~{place.etaMinutes} min
                  </p>
                </div>
              </div>
              <div className="mt-3 flex gap-2">
                <Button
                  asChild
                  className="h-11 flex-1 rounded-xl bg-alert text-sm font-bold text-alert-foreground hover:bg-alert/90"
                >
                  <a href={`tel:${tel}`}>
                    <PhoneCall className="size-4" /> Call
                  </a>
                </Button>
                <Button
                  asChild
                  variant="outline"
                  className="h-11 flex-1 rounded-xl bg-card text-sm font-bold"
                >
                  <a
                    href={mapsHref(place, "navigate")}
                    onClick={mapsClickHandler(place, "navigate")}
                    target="_blank"
                    rel="noreferrer"
                  >
                    <Navigation className="size-4" /> Navigate
                  </a>
                </Button>
                <Button
                  asChild
                  size="icon"
                  variant="outline"
                  className="size-11 shrink-0 rounded-xl bg-card"
                >
                  <a
                    href={mapsHref(place, "view")}
                    onClick={mapsClickHandler(place, "view")}
                    target="_blank"
                    rel="noreferrer"
                    aria-label={`Open ${place.name} on the map`}
                  >
                    <MapPin className="size-4" />
                  </a>
                </Button>
              </div>
              <Button
                asChild
                variant="ghost"
                size="sm"
                className="mt-2 h-9 w-full rounded-lg text-xs font-bold text-muted-foreground"
              >
                <Link to="/nearby" search={{ category: row.category }}>
                  View more {row.label.toLowerCase()}s
                  <ChevronRight className="size-3.5" />
                </Link>
              </Button>
            </motion.li>
          );
        })}
      </ul>
    </section>
  );
}
