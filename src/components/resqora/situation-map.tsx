/**
 * Situation map — a dependency-free, SSR-safe plot of everything that matters
 * on one canvas: live incidents, response units and hazard advisories.
 *
 * We deliberately avoid a browser-only mapping library here: the Command
 * Centre must render during SSR and keep working offline. Points are projected
 * from latitude/longitude into a padded SVG box, so relative geography (who is
 * near what) stays readable without any network tiles.
 */
import { useMemo } from "react";
import { Map as MapIcon } from "lucide-react";
import { EmptyState } from "@/components/system/empty-state";

export type MapPoint = {
  id: string;
  label: string;
  latitude: number;
  longitude: number;
  kind: "incident" | "resource" | "zone";
  detail?: string;
  radiusKm?: number;
  muted?: boolean;
};

const TONES: Record<MapPoint["kind"], { fill: string; ring: string; legend: string }> = {
  incident: {
    fill: "var(--color-destructive)",
    ring: "var(--color-destructive)",
    legend: "Incidents",
  },
  resource: {
    fill: "var(--color-primary)",
    ring: "var(--color-primary)",
    legend: "Response units",
  },
  zone: {
    fill: "var(--color-muted-foreground)",
    ring: "var(--color-border)",
    legend: "Hazard areas",
  },
};

const W = 720;
const H = 360;
const PAD = 34;

export function SituationMap({
  points,
  className = "",
}: {
  points: MapPoint[];
  className?: string;
}) {
  const usable = points.filter(
    (point) => Number.isFinite(point.latitude) && Number.isFinite(point.longitude),
  );

  const projected = useMemo(() => {
    if (usable.length === 0) return [];
    const lats = usable.map((p) => p.latitude);
    const lngs = usable.map((p) => p.longitude);
    const minLat = Math.min(...lats);
    const maxLat = Math.max(...lats);
    const minLng = Math.min(...lngs);
    const maxLng = Math.max(...lngs);
    const spanLat = Math.max(maxLat - minLat, 0.01);
    const spanLng = Math.max(maxLng - minLng, 0.01);
    // Kilometres per SVG unit, used to draw advisory radii at the right scale.
    const kmPerUnitX = (spanLng * 111 * Math.cos((minLat * Math.PI) / 180)) / (W - PAD * 2);

    return usable.map((point) => ({
      ...point,
      x: PAD + ((point.longitude - minLng) / spanLng) * (W - PAD * 2),
      y: H - PAD - ((point.latitude - minLat) / spanLat) * (H - PAD * 2),
      r: point.radiusKm ? Math.max(12, point.radiusKm / Math.max(kmPerUnitX, 0.0001)) : 0,
    }));
  }, [usable]);

  if (projected.length === 0) {
    return (
      <EmptyState
        icon={MapIcon}
        title="Nothing to place on the map yet"
        description="As soon as an incident, a response unit or a hazard advisory has a location, it appears here."
      />
    );
  }

  const kinds = Array.from(new Set(projected.map((point) => point.kind)));

  return (
    <div className={`space-y-3 ${className}`}>
      <div className="overflow-hidden rounded-2xl border border-border bg-muted/30">
        <svg
          viewBox={`0 0 ${W} ${H}`}
          role="img"
          aria-label={`Situation map with ${projected.length} plotted locations`}
          className="h-auto w-full"
        >
          <defs>
            <pattern id="situation-grid" width="48" height="48" patternUnits="userSpaceOnUse">
              <path
                d="M48 0H0v48"
                fill="none"
                stroke="var(--color-border)"
                strokeWidth="1"
                opacity="0.5"
              />
            </pattern>
          </defs>
          <rect width={W} height={H} fill="url(#situation-grid)" />

          {projected
            .filter((point) => point.kind === "zone")
            .map((point) => (
              <circle
                key={`zone-${point.id}`}
                cx={point.x}
                cy={point.y}
                r={point.r || 20}
                fill="var(--color-alert)"
                opacity="0.14"
                stroke="var(--color-alert)"
                strokeDasharray="5 4"
              />
            ))}

          {projected.map((point) => {
            const tone = TONES[point.kind];
            return (
              <g key={`${point.kind}-${point.id}`} opacity={point.muted ? 0.5 : 1}>
                <circle
                  cx={point.x}
                  cy={point.y}
                  r={point.kind === "incident" ? 13 : 10}
                  fill={tone.ring}
                  opacity="0.2"
                />
                <circle
                  cx={point.x}
                  cy={point.y}
                  r={point.kind === "incident" ? 6.5 : 5}
                  fill={tone.fill}
                />
                <text
                  x={point.x}
                  y={point.y - 15}
                  textAnchor="middle"
                  fontSize="11"
                  fill="var(--color-foreground)"
                >
                  {point.label.slice(0, 22)}
                </text>
              </g>
            );
          })}
        </svg>
      </div>

      <ul className="flex flex-wrap gap-4 text-xs text-muted-foreground">
        {kinds.map((kind) => (
          <li key={kind} className="flex items-center gap-2">
            <span
              className="size-2.5 rounded-full"
              style={{ background: TONES[kind].fill }}
              aria-hidden="true"
            />
            {TONES[kind].legend}
          </li>
        ))}
      </ul>
    </div>
  );
}
