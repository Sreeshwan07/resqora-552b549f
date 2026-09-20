import { motion } from "motion/react";
import { Clock3, MapPin, Navigation, Satellite } from "lucide-react";
import { cn } from "@/lib/utils";
import type { LivePosition } from "@/hooks/use-live-position";
import { useHydrated } from "@/hooks/use-hydrated";

export type LandingStatus = "safe" | "checkin" | "active" | "coordinating" | "resolved";

const STATUS_META: Record<LandingStatus, { label: string; dot: string; ring: string }> = {
  safe: { label: "SAFE", dot: "bg-success", ring: "text-success" },
  checkin: {
    label: "Safety check pending",
    dot: "bg-warning",
    ring: "text-warning",
  },
  active: { label: "EMERGENCY ACTIVE", dot: "bg-alert", ring: "text-alert" },
  coordinating: {
    label: "EMERGENCY ACTIVE",
    dot: "bg-alert",
    ring: "text-alert",
  },
  resolved: {
    label: "EMERGENCY RESOLVED",
    dot: "bg-success",
    ring: "text-success",
  },
};

export function EmergencyStatusCard({
  status,
  now,
  position,
  address,
  denied,
  resolvingAddress,
}: {
  status: LandingStatus;
  now: Date;
  position: LivePosition | null;
  address: string | null;
  denied: boolean;
  resolvingAddress?: boolean;
}) {
  const meta = STATUS_META[status];
  const locationLabel = address
    ? address
    : position
      ? resolvingAddress
        ? "Resolving address…"
        : `${position.lat.toFixed(5)}, ${position.lng.toFixed(5)}`
      : denied
        ? "Add your address to continue"
        : "Getting your location…";
  // Locale time only renders after hydration so SSR markup can't mismatch.
  const hydrated = useHydrated();
  const critical = status === "active" || status === "coordinating";
  return (
    <motion.section
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.35 }}
      aria-label="Live safety status"
      className={cn(
        "soft-card h-full rounded-2xl p-5 sm:p-6",
        critical && "border-alert/50 bg-alert/5 ring-1 ring-alert/30",
      )}
    >
      <div className="mb-5 flex items-center justify-between gap-3">
        <div className="flex items-center gap-2.5">
          <span
            className={cn("size-2.5 shrink-0 animate-pulse rounded-full", meta.dot)}
            aria-hidden="true"
          />
          <h2 className={cn("font-display text-base font-extrabold", meta.ring)}>{meta.label}</h2>
        </div>
        <span className="inline-flex items-center gap-1.5 rounded-full bg-muted px-2.5 py-1 text-[11px] font-semibold text-muted-foreground">
          <Navigation className="size-3.5 text-teal" aria-hidden="true" />
          {position ? "Location ready" : "Location needed"}
        </span>
      </div>

      <dl className="grid gap-4 sm:grid-cols-[minmax(0,1.5fr)_0.75fr_0.9fr]">
        <div className="min-w-0 rounded-xl bg-muted/60 p-4">
          <dt className="flex items-center gap-2 text-[11px] font-semibold uppercase text-muted-foreground">
            <MapPin className="size-4 shrink-0 text-teal" aria-hidden="true" />
            Current address
          </dt>
          <dd className="mt-2 text-sm font-semibold leading-relaxed text-foreground">
            <span className="min-w-0 break-words">{locationLabel}</span>
          </dd>
        </div>

        <div className="min-w-0 rounded-xl border border-border/70 p-4">
          <dt className="flex items-center gap-2 text-[11px] font-semibold uppercase text-muted-foreground">
            <Satellite className="size-4 shrink-0 text-teal" aria-hidden="true" />
            GPS accuracy
          </dt>
          <dd className="mt-2 font-display text-xl font-extrabold text-foreground">
            {position ? `±${Math.round(position.accuracy)} m` : "—"}
          </dd>
        </div>

        <div className="min-w-0 rounded-xl border border-border/70 p-4">
          <dt className="flex items-center gap-2 text-[11px] font-semibold uppercase text-muted-foreground">
            <Clock3 className="size-4 shrink-0 text-teal" aria-hidden="true" />
            Last update
          </dt>
          <dd className="mt-2 font-mono text-lg font-bold text-foreground">
            {hydrated
              ? now.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })
              : "--:--"}
          </dd>
        </div>
      </dl>
    </motion.section>
  );
}
