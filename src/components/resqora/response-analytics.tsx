/**
 * Response performance — measured from the incident record itself, never from
 * invented numbers. Every figure below is derived from timestamps the server
 * wrote (alert sent, acknowledged, resolved), so an empty history honestly
 * shows "not enough incidents yet" instead of a demo chart.
 */
import { useMemo } from "react";
import { queryOptions, useQuery } from "@tanstack/react-query";
import { Timer } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { PanelSkeleton } from "@/components/system/loading-skeletons";
import { supabase } from "@/integrations/supabase/client";

type Row = {
  id: string;
  phase: string;
  started_at: string;
  notified_at: string | null;
  ack_at: string | null;
  resolved_at: string | null;
  duration_seconds: number | null;
  is_simulation: boolean;
  escalation_level: number;
};

const analyticsQuery = (userId: string | undefined) =>
  queryOptions({
    queryKey: ["response-analytics", userId],
    enabled: Boolean(userId),
    staleTime: 30_000,
    queryFn: async (): Promise<Row[]> => {
      const { data, error } = await supabase
        .from("emergencies")
        .select(
          "id, phase, started_at, notified_at, ack_at, resolved_at, duration_seconds, is_simulation, escalation_level",
        )
        .order("started_at", { ascending: false })
        .limit(200);
      if (error) throw new Error(error.message);
      return (data ?? []) as Row[];
    },
  });

function median(values: number[]) {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : Math.round((sorted[mid - 1] + sorted[mid]) / 2);
}

function gap(from: string | null, to: string | null) {
  if (!from || !to) return null;
  const seconds = (new Date(to).getTime() - new Date(from).getTime()) / 1000;
  return seconds >= 0 && seconds < 60 * 60 * 24 ? seconds : null;
}

function humanSeconds(seconds: number | null) {
  if (seconds === null) return "—";
  if (seconds < 90) return `${Math.round(seconds)} sec`;
  if (seconds < 60 * 90) return `${Math.round(seconds / 60)} min`;
  return `${(seconds / 3600).toFixed(1)} hr`;
}

export function ResponseAnalytics({ userId }: { userId: string | undefined }) {
  const rows = useQuery(analyticsQuery(userId));

  const stats = useMemo(() => {
    const all = rows.data ?? [];
    const real = all.filter((row) => !row.is_simulation);
    const alertTimes = all
      .map((row) => gap(row.started_at, row.notified_at))
      .filter((value): value is number => value !== null);
    const ackTimes = all
      .map((row) => gap(row.notified_at ?? row.started_at, row.ack_at))
      .filter((value): value is number => value !== null);
    const closeTimes = all
      .map((row) => row.duration_seconds ?? gap(row.started_at, row.resolved_at))
      .filter((value): value is number => value !== null);
    const resolved = all.filter((row) => row.phase === "resolved").length;
    const escalated = all.filter((row) => (row.escalation_level ?? 0) > 0).length;

    return {
      total: all.length,
      real: real.length,
      simulated: all.length - real.length,
      alert: median(alertTimes),
      ack: median(ackTimes),
      close: median(closeTimes),
      acknowledged: ackTimes.length,
      resolvedRate: all.length ? Math.round((resolved / all.length) * 100) : null,
      escalated,
    };
  }, [rows.data]);

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <Timer className="size-4 text-primary" aria-hidden="true" />
          Response performance
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {rows.isLoading ? (
          <PanelSkeleton />
        ) : stats.total === 0 ? (
          <p className="text-sm text-muted-foreground">
            No incidents recorded yet, so there is nothing to measure. These figures fill in
            automatically from real incident timestamps.
          </p>
        ) : (
          <>
            <dl className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              <Metric label="Time to alert contacts" value={humanSeconds(stats.alert)} />
              <Metric label="Time to acknowledgement" value={humanSeconds(stats.ack)} />
              <Metric label="Time to close" value={humanSeconds(stats.close)} />
              <Metric
                label="Closed as resolved"
                value={stats.resolvedRate === null ? "—" : `${stats.resolvedRate}%`}
              />
            </dl>
            <p className="text-xs text-muted-foreground">
              Based on {stats.total} incident{stats.total === 1 ? "" : "s"} ({stats.real} real,{" "}
              {stats.simulated} simulation). {stats.acknowledged} acknowledged by a contact,{" "}
              {stats.escalated} needed escalation. Median values; a dash means not enough data yet.
            </p>
          </>
        )}
      </CardContent>
    </Card>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border border-border p-3">
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="mt-1 text-lg font-semibold text-foreground">{value}</dd>
    </div>
  );
}
