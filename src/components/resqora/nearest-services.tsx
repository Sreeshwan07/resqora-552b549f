import { EMERGENCY_PHONE } from "@/lib/accident";
import { useState } from "react";
import { motion } from "motion/react";
import {
  ChevronDown,
  Droplets,
  Ambulance,
  Flame,
  MapPin,
  Navigation,
  PhoneCall,
  RefreshCw,
  Search,
  ShieldCheck,
  Stethoscope,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { mapsClickHandler, mapsHref } from "@/lib/maps";
import type { NearbyPlace, PlaceCategory } from "@/lib/nearby.server";
import { useNearbyServices, type NearbyOrigin } from "@/hooks/use-nearby-services";
import type { LivePosition } from "@/hooks/use-live-position";
import { cn } from "@/lib/utils";

export const CATEGORY_ICON: Record<PlaceCategory, typeof Stethoscope> = {
  hospital: Stethoscope,
  ambulance: Ambulance,
  police: ShieldCheck,
  fire: Flame,
  blood_bank: Droplets,
};

export const CATEGORY_LABEL: Record<PlaceCategory, string> = {
  hospital: "Hospitals",
  ambulance: "Ambulance services",
  police: "Police stations",
  fire: "Fire & rescue",
  blood_bank: "Blood banks",
};

export const CATEGORY_EMOJI: Record<PlaceCategory, string> = {
  hospital: "🏥",
  ambulance: "🚑",
  police: "🚓",
  fire: "🚒",
  blood_bank: "🩸",
};

const DEFAULT_CATEGORIES: PlaceCategory[] = [
  "hospital",
  "ambulance",
  "police",
  "fire",
  "blood_bank",
];

/** Official Indian emergency numbers used when a facility publishes no number. */
const NATIONAL_NUMBER: Record<PlaceCategory, string> = {
  hospital: EMERGENCY_PHONE.ambulance,
  ambulance: EMERGENCY_PHONE.ambulance,
  police: EMERGENCY_PHONE.police,
  fire: EMERGENCY_PHONE.fire,
  blood_bank: EMERGENCY_PHONE.ambulance,
};

export function PlaceCard({
  place,
  origin,
  rank,
  serviceLabel,
}: {
  place: NearbyPlace;
  origin: NearbyOrigin | null;
  rank?: number;
  serviceLabel?: string;
}) {
  const verified = place.phone ? place.phone.replace(/[^+\d]/g, "") : null;
  const tel = verified ?? NATIONAL_NUMBER[place.category];
  const Icon = CATEGORY_ICON[place.category];
  return (
    <div className="rounded-3xl border border-border/70 bg-card p-4 sm:p-5">
      <div className="flex min-w-0 items-start gap-3">
        <span
          aria-hidden="true"
          className="grid size-11 shrink-0 place-items-center rounded-2xl bg-teal/10 text-teal"
        >
          <Icon className="size-5" />
        </span>
        <div className="min-w-0">
          <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
            {serviceLabel ?? CATEGORY_LABEL[place.category]}
          </p>
          <p className="mt-0.5 truncate font-display text-base font-bold text-foreground">
            {place.name}
          </p>
          {place.address && (
            <p className="mt-1 line-clamp-2 text-xs text-muted-foreground">{place.address}</p>
          )}
        </div>
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-1.5">
        <Badge variant="secondary" className="rounded-full text-[11px] font-bold">
          {place.distanceKm.toFixed(1)} km
        </Badge>
        <Badge variant="secondary" className="rounded-full text-[11px] font-bold">
          ETA ~{place.etaMinutes} min
        </Badge>
      </div>

      <div className="mt-4 flex gap-2">
        <Button
          asChild
          size="lg"
          className="h-12 flex-1 rounded-2xl bg-alert text-sm font-bold text-alert-foreground hover:bg-alert/90"
        >
          <a href={`tel:${tel}`}>
            <PhoneCall className="size-4" /> Call
          </a>
        </Button>
        <Button
          asChild
          size="lg"
          variant="outline"
          className="h-12 flex-1 rounded-2xl bg-card text-sm font-bold"
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
          className="size-12 shrink-0 rounded-full bg-card"
        >
          <a
            href={mapsHref(place, "view")}
            onClick={mapsClickHandler(place, "view")}
            target="_blank"
            rel="noreferrer"
            aria-label={`Open ${place.name} on Google Maps`}
          >
            <MapPin className="size-4" />
          </a>
        </Button>
      </div>
    </div>
  );
}

function CategoryCard({
  category,
  places,
  origin,
  loading,
}: {
  category: PlaceCategory;
  places: NearbyPlace[];
  origin: NearbyOrigin | null;
  loading: boolean;
}) {
  const [expanded, setExpanded] = useState(false);

  // Top 3 nearest per category, expandable to the full shortlist.
  const ordered = [...places].sort((a, b) => a.distanceKm - b.distanceKm);
  const visible = expanded ? ordered.slice(0, 6) : ordered.slice(0, 3);

  return (
    <div className="min-w-0">
      <div className="grid gap-2">
        {loading && places.length === 0 ? (
          <Skeleton className="h-44 w-full rounded-3xl" />
        ) : places.length === 0 ? (
          <p className="rounded-3xl border border-dashed border-border p-4 text-xs text-muted-foreground">
            No nearby {CATEGORY_LABEL[category].toLowerCase()} found.
          </p>
        ) : (
          visible.map((place, index) => (
            <motion.div
              key={place.id}
              initial={{ opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.2, delay: index * 0.04 }}
            >
              <PlaceCard place={place} origin={origin} serviceLabel={CATEGORY_LABEL[category]} />
            </motion.div>
          ))
        )}
      </div>
      {places.length > 3 && (
        <Button
          size="sm"
          variant="ghost"
          className="mt-2 h-9 w-full rounded-2xl text-xs font-bold text-muted-foreground"
          onClick={() => setExpanded((value) => !value)}
          aria-expanded={expanded}
        >
          {expanded ? "Show less" : `View more ${CATEGORY_LABEL[category].toLowerCase()}`}
          <ChevronDown className={cn("size-3.5 transition-transform", expanded && "rotate-180")} />
        </Button>
      )}
    </div>
  );
}

/** Real-time nearest emergency services grouped into expandable category cards. */
export function NearestServices({
  position,
  categories = DEFAULT_CATEGORIES,
  title = "Nearest emergency services",
  nearby,
}: {
  position: LivePosition | null;
  categories?: PlaceCategory[];
  title?: string;
  nearby?: ReturnType<typeof useNearbyServices>;
}) {
  const fallback = useNearbyServices(nearby ? null : position);
  const state = nearby ?? fallback;
  const [addressInput, setAddressInput] = useState("");
  const needsManual = !position && !state.manual;

  return (
    <section aria-label={title} className="soft-card rounded-3xl p-4 sm:p-6">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="font-display text-lg font-extrabold tracking-tight text-foreground sm:text-xl">
          {title}
        </h2>
        <div className="flex items-center gap-2">
          <p className="text-[11px] text-muted-foreground">
            {state.updatedAt
              ? `Location updated · ${state.updatedAt.toLocaleTimeString()}`
              : state.origin
                ? "Finding nearby emergency services…"
                : "Getting your location…"}
          </p>
          <Button
            size="icon"
            variant="ghost"
            aria-label="Refresh nearby services"
            disabled={!state.origin || state.isFetching}
            onClick={() => void state.refresh()}
          >
            <RefreshCw className={cn("size-4", state.isFetching && "animate-spin")} />
          </Button>
        </div>
      </div>

      {state.manualLabel && (
        <p className="mt-1 inline-flex items-center gap-1 text-[11px] text-muted-foreground">
          <MapPin className="size-3" /> Searching around {state.manualLabel}
          <button
            type="button"
            className="ml-1 underline"
            onClick={() => {
              state.clearManual();
              setAddressInput("");
            }}
          >
            reset
          </button>
        </p>
      )}

      {needsManual && (
        <form
          className="mt-3 flex gap-2"
          onSubmit={(event) => {
            event.preventDefault();
            if (addressInput.trim().length > 1) void state.searchAddress(addressInput.trim());
          }}
        >
          <Input
            value={addressInput}
            onChange={(event) => setAddressInput(event.target.value)}
            placeholder="Enter your address or city"
            aria-label="Address or city"
          />
          <Button type="submit" variant="secondary" disabled={state.geocoding}>
            <Search className="size-4" /> Find
          </Button>
        </form>
      )}
      {state.manualError && <p className="mt-2 text-xs text-alert">{state.manualError}</p>}
      {state.error && (
        <p className="mt-2 text-xs text-alert">
          Live service lookup failed. Tap refresh to try again.
        </p>
      )}

      <div className="mt-4 grid gap-3 sm:grid-cols-2 sm:gap-4">
        {categories.map((category) => (
          <CategoryCard
            key={category}
            category={category}
            places={state.data[category]}
            origin={state.origin}
            loading={state.isLoading}
          />
        ))}
      </div>
    </section>
  );
}
