import { CheckCircle2, CircleDashed, Clock, Navigation, ShieldAlert, Siren } from "lucide-react";
import { cn } from "@/lib/utils";
import { statusMeta } from "@/lib/safe-journey";

const TONE_CLASS: Record<string, string> = {
  safe: "border-success/40 bg-success/10 text-success",
  active: "border-info/40 bg-info/10 text-info",
  warning: "border-warning/50 bg-warning/15 text-warning",
  critical: "border-alert/50 bg-alert/15 text-alert",
  muted: "border-border bg-muted text-muted-foreground",
};

const ICONS: Record<string, typeof Clock> = {
  planned: CircleDashed,
  active: Navigation,
  arriving: Navigation,
  check_in_required: Clock,
  check_in_missed: ShieldAlert,
  guardian_notified: ShieldAlert,
  emergency_escalated: Siren,
  completed: CheckCircle2,
  cancelled: CircleDashed,
};

/** Status is always shown as an icon + words, never colour alone. */
export function JourneyStatusBadge({ status, className }: { status: string; className?: string }) {
  const meta = statusMeta(status);
  const Icon = ICONS[status] ?? CircleDashed;
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-semibold",
        TONE_CLASS[meta.tone],
        className,
      )}
    >
      <Icon className="size-3.5" aria-hidden="true" />
      {meta.label}
    </span>
  );
}
