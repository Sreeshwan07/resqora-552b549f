/**
 * Performance evaluation — runs the representative scenarios live and charts
 * only measured results stored in the database. No simulated numbers.
 */
import { useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Activity, Download, Loader2, Play } from "lucide-react";
import { toast } from "sonner";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { PageHeader } from "@/components/system/page-header";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  buildTechnicalReport,
  listPerfRuns,
  runPerformanceSuite,
  stats,
  type PerfRun,
} from "@/lib/perf-tests";

export const Route = createFileRoute("/_app/performance")({
  head: () => ({
    meta: [
      { title: "Performance evaluation — RESQORA" },
      {
        name: "description",
        content:
          "Run RESQORA's representative emergency SOS performance scenarios and view measured latency, concurrency and retry results.",
      },
      { property: "og:title", content: "RESQORA performance evaluation" },
      {
        property: "og:description",
        content: "Measured SOS, location, concurrency and retry performance for RESQORA.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: PerformancePage,
});

function download(name: string, text: string) {
  const url = URL.createObjectURL(new Blob([text], { type: "text/markdown" }));
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  URL.revokeObjectURL(url);
}

function PerformancePage() {
  const qc = useQueryClient();
  const runs = useQuery({ queryKey: ["perf-runs"], queryFn: listPerfRuns });
  const [busy, setBusy] = useState<string | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const list = runs.data ?? [];
  const run: PerfRun | null = list.find((r) => r.id === selected) ?? list[0] ?? null;

  async function start() {
    setBusy("Starting…");
    try {
      const r = await runPerformanceSuite(setBusy);
      setSelected(r.id ?? null);
      await qc.invalidateQueries({ queryKey: ["perf-runs"] });
      toast.success("Performance run finished and saved");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Performance run failed");
    } finally {
      setBusy(null);
    }
  }

  const chart = (run?.results ?? []).map((r) => {
    const s = stats(r.samples);
    return { name: r.id.toUpperCase(), avg: s.avg, min: s.min, max: s.max, ok: s.ok, failed: s.failed };
  });

  return (
    <div className="space-y-4">
      <PageHeader
        icon={Activity}
        title="Performance evaluation"
        description="Measured live against the real backend. Test emergencies are marked as simulations, send no alerts and are cancelled afterwards."
      />
      <div className="flex flex-wrap gap-2">
        <Button onClick={start} disabled={Boolean(busy)}>
          {busy ? <Loader2 className="size-4 animate-spin" /> : <Play className="size-4" />}
          {busy ?? "Run test scenarios"}
        </Button>
        <Button
          variant="outline"
          onClick={() => download("resqora-technical-report.md", buildTechnicalReport(run))}
        >
          <Download className="size-4" /> Technical report
        </Button>
      </div>

      {!run ? (
        <Card>
          <CardContent className="p-6 text-sm text-muted-foreground">
            No measurements yet. Run the scenarios to record real results.
          </CardContent>
        </Card>
      ) : (
        <>
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base">
                <Activity className="size-4" /> Test environment
              </CardTitle>
            </CardHeader>
            <CardContent className="grid gap-1 text-xs sm:grid-cols-2">
              <p>
                <b>Test date:</b> {new Date(run.started_at).toLocaleString()}
              </p>
              {Object.entries(run.environment).map(([k, v]) => (
                <p key={k} className="break-words">
                  <b>{k.replace(/_/g, " ")}:</b> {String(v)}
                </p>
              ))}
              {list.length > 1 && (
                <select
                  className="mt-2 rounded-md border bg-background p-1 sm:col-span-2"
                  value={run.id}
                  onChange={(e) => setSelected(e.target.value)}
                  aria-label="Choose test run"
                >
                  {list.map((r) => (
                    <option key={r.id} value={r.id}>
                      {new Date(r.started_at).toLocaleString()}
                    </option>
                  ))}
                </select>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">Response time per scenario (ms)</CardTitle>
            </CardHeader>
            <CardContent className="h-72">
              <ResponsiveContainer>
                <BarChart data={chart}>
                  <CartesianGrid strokeDasharray="3 3" className="stroke-border" />
                  <XAxis dataKey="name" fontSize={11} />
                  <YAxis fontSize={11} unit=" ms" />
                  <Tooltip />
                  <Legend />
                  <Bar dataKey="min" name="Min" fill="var(--color-success)" />
                  <Bar dataKey="avg" name="Average" fill="var(--color-primary)" />
                  <Bar dataKey="max" name="Max" fill="var(--color-alert)" />
                </BarChart>
              </ResponsiveContainer>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">Successful vs failed/blocked requests</CardTitle>
            </CardHeader>
            <CardContent className="h-60">
              <ResponsiveContainer>
                <BarChart data={chart}>
                  <CartesianGrid strokeDasharray="3 3" className="stroke-border" />
                  <XAxis dataKey="name" fontSize={11} />
                  <YAxis fontSize={11} allowDecimals={false} />
                  <Tooltip />
                  <Legend />
                  <Bar dataKey="ok" name="Succeeded" stackId="a" fill="var(--color-success)" />
                  <Bar dataKey="failed" name="Failed / blocked" stackId="a" fill="var(--color-warning)" />
                </BarChart>
              </ResponsiveContainer>
            </CardContent>
          </Card>

          <div className="grid gap-3 md:grid-cols-2">
            {run.results.map((r) => {
              const s = stats(r.samples);
              return (
                <Card key={r.id}>
                  <CardContent className="space-y-1 p-4 text-xs">
                    <div className="flex items-start justify-between gap-2">
                      <p className="text-sm font-semibold">{r.title}</p>
                      <Badge variant={r.check.passed ? "default" : "destructive"}>
                        {r.check.passed ? "PASS" : "FAIL"}
                      </Badge>
                    </div>
                    <p className="text-muted-foreground">
                      Metric: {r.metric} · Unit: ms · Requests: {r.requests}
                    </p>
                    <p>
                      Avg {s.avg} · Min {s.min} · Max {s.max} · p95 {s.p95}
                    </p>
                    <p>
                      {r.check.label}: {r.check.detail}
                    </p>
                  </CardContent>
                </Card>
              );
            })}
          </div>
          <p className="text-xs text-muted-foreground">
            Notification delivery latency is not measured: no email/SMS provider is connected and
            tests never send real alerts. Multi-user scenarios use independent connections of one
            account.
          </p>
        </>
      )}
    </div>
  );
}
