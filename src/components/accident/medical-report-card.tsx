import { confidenceLabel } from "@/lib/critical-signs";
import { AlertTriangle, Info, Sparkles, Users } from "lucide-react";
import {
  AI_DISCLAIMER,
  PRIORITY_LABEL,
  SEVERITY_META,
  SPECIALTY_META,
  type AccidentReport,
} from "@/lib/accident";
import { cn } from "@/lib/utils";

export function MedicalReportCard({
  report,
  preview,
  incidentId,
  address,
  capturedAt,
  orientation,
  coords,
}: {
  report: AccidentReport;
  preview: string | null;
  incidentId: string;
  address: string | null;
  capturedAt: Date;
  orientation: string | null;
  coords: { lat: number; lng: number } | null;
}) {
  const meta = SEVERITY_META[report.severity];

  return (
    <section
      aria-label="AI emergency medical report"
      className={cn("glass-panel rounded-3xl border p-4 sm:p-5", meta.ring)}
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="flex items-center gap-2 text-base font-semibold text-foreground">
          <Sparkles className="size-4 text-primary" aria-hidden="true" />
          AI emergency medical report
        </h2>
        <span className="font-mono text-xs font-semibold text-muted-foreground">{incidentId}</span>
      </div>

      <div className="mt-4 flex flex-col gap-4 sm:flex-row">
        {preview && (
          <img
            src={preview}
            alt="Reported accident scene"
            className="h-40 w-full rounded-2xl object-cover sm:h-36 sm:w-48"
          />
        )}
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="rounded-full border border-border/60 px-3 py-1 text-sm font-semibold text-foreground">
              {report.incidentLabel}
            </span>
            <span
              className={cn(
                "rounded-full border px-3 py-1 text-sm font-bold uppercase tracking-wide",
                meta.chip,
              )}
            >
              {meta.label}
            </span>
            <span
              className={cn(
                "rounded-full border px-3 py-1 text-xs font-bold tracking-widest",
                meta.chip,
              )}
            >
              PRIORITY {PRIORITY_LABEL[meta.priority]}
            </span>
            <span className="text-xs font-medium text-muted-foreground">
              AI confidence: {confidenceLabel(report.confidence)}
            </span>
            {report.victimCount != null && (
              <span className="flex items-center gap-1 text-xs font-medium text-muted-foreground">
                <Users className="size-3.5" aria-hidden="true" />
                {report.victimCount} victim{report.victimCount > 1 ? "s" : ""} detected
              </span>
            )}
          </div>
          <p className="mt-3 text-sm text-foreground">{report.summary}</p>
          <dl className="mt-3 grid gap-x-4 gap-y-1 text-xs text-muted-foreground sm:grid-cols-2">
            <Field label="Location" value={address ?? "Resolving address…"} />
            <Field
              label="Coordinates"
              value={coords ? `${coords.lat.toFixed(5)}, ${coords.lng.toFixed(5)}` : "Awaiting GPS"}
            />
            <Field label="Reported" value={capturedAt.toLocaleString()} />
            <Field label="Device orientation" value={orientation ?? "Not available"} />
            <Field label="Routing to" value={SPECIALTY_META[report.hospitalSpecialty].label} />
          </dl>
        </div>
      </div>

      <div className="mt-4 grid gap-3 sm:grid-cols-2">
        <Block
          title="Visible situation"
          items={report.observations.length ? report.observations : [report.incidentLabel]}
        />
        <Block
          title="Possible visible injuries"
          tone="alert"
          items={
            report.possibleInjuries.length
              ? report.possibleInjuries
              : ["No specific injuries visible in the media"]
          }
        />
        {report.hazards.length > 0 && (
          <Block title="Scene hazards" tone="warning" items={report.hazards} />
        )}
        {report.recommendedActions.length > 0 && (
          <Block title="Recommended next actions" items={report.recommendedActions} />
        )}
      </div>

      <p className="mt-4 flex gap-2 rounded-2xl border border-border/60 bg-muted/40 p-3 text-xs text-muted-foreground">
        <Info className="mt-0.5 size-3.5 shrink-0" aria-hidden="true" />
        {AI_DISCLAIMER}
      </p>
    </section>
  );
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex gap-1.5">
      <dt className="font-medium text-foreground/70">{label}:</dt>
      <dd className="min-w-0 truncate">{value}</dd>
    </div>
  );
}

function Block({
  title,
  items,
  tone,
}: {
  title: string;
  items: string[];
  tone?: "alert" | "warning";
}) {
  return (
    <div
      className={cn(
        "rounded-2xl border p-3",
        tone === "alert"
          ? "border-alert/40 bg-alert/5"
          : tone === "warning"
            ? "border-warning/40 bg-warning/5"
            : "border-border/60 bg-card/60",
      )}
    >
      <p className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-foreground">
        {tone && <AlertTriangle className="size-3.5" aria-hidden="true" />}
        {title}
      </p>
      <ul className="mt-2 space-y-1 text-sm text-muted-foreground">
        {items.map((item) => (
          <li key={item} className="flex gap-2">
            <span aria-hidden="true">•</span>
            <span className="min-w-0">{item}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
