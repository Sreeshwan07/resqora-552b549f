import { useEffect, useMemo } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, ClipboardCheck, ShieldCheck } from "lucide-react";
import { toast } from "sonner";
import { PageHeader } from "@/components/system/page-header";
import { PanelSkeleton } from "@/components/system/loading-skeletons";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Progress } from "@/components/ui/progress";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useAuth } from "@/hooks/use-auth";
import { useLivePosition } from "@/hooks/use-live-position";
import {
  ensurePreparednessPlan,
  preparednessQuery,
  setPreparednessDone,
  zoneSeverityLabel,
  zoneTypeLabel,
  zonesAround,
  zonesQuery,
  type PreparednessTask,
} from "@/lib/prepare";

export const Route = createFileRoute("/_app/prepare")({
  head: () => ({
    meta: [
      { title: "Prepare — RESQORA" },
      {
        name: "description",
        content:
          "Get ready before anything happens: work through your household preparedness plan, pack a go-bag and see the hazard advisories active around you.",
      },
      { property: "og:title", content: "Prepare with RESQORA" },
      {
        property: "og:description",
        content: "Your preparedness plan and live hazard advisories in one place.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: PreparePage,
});

function PreparePage() {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const { position } = useLivePosition();
  const tasks = useQuery(preparednessQuery(user?.id));
  const zones = useQuery(zonesQuery());

  // Give a new member the starter plan the first time they open this page.
  useEffect(() => {
    if (!user?.id || !tasks.data) return;
    ensurePreparednessPlan(user.id, tasks.data)
      .then((added) => {
        if (added) queryClient.invalidateQueries({ queryKey: ["preparedness-tasks", user.id] });
      })
      .catch(() => {
        /* the plan simply stays as-is if this fails; nothing is lost */
      });
  }, [user?.id, tasks.data, queryClient]);

  const toggle = useMutation({
    mutationFn: (input: { id: string; done: boolean }) =>
      setPreparednessDone(input.id, input.done),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["preparedness-tasks", user?.id] });
    },
    onError: (error: Error) => toast.error(error.message),
  });

  const groups = useMemo(() => {
    const map = new Map<string, PreparednessTask[]>();
    for (const task of tasks.data ?? []) {
      const list = map.get(task.category) ?? [];
      list.push(task);
      map.set(task.category, list);
    }
    return [...map.entries()];
  }, [tasks.data]);

  const total = (tasks.data ?? []).length;
  const done = (tasks.data ?? []).filter((task) => task.done).length;
  const readiness = total === 0 ? 0 : Math.round((done / total) * 100);
  const nearby = zonesAround(
    zones.data ?? [],
    position ? { latitude: position.lat, longitude: position.lng } : null,
  );

  return (
    <div className="space-y-6">
      <PageHeader
        icon={ShieldCheck}
        title="Prepare"
        description="Most of what saves time in an emergency is decided before it starts. Work through this once, then keep it current."
      />

      {nearby.length > 0 && (
        <Card className="border-destructive/50 bg-destructive/5">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <AlertTriangle className="size-5 text-destructive" aria-hidden="true" />
              You are inside an active advisory area
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {nearby.map(({ zone, km }) => (
              <div key={zone.id} className="rounded-xl border border-border bg-card p-3">
                <div className="flex items-center justify-between gap-2">
                  <p className="truncate text-sm font-medium">{zone.name}</p>
                  <Badge variant="destructive">{zoneSeverityLabel(zone.severity)}</Badge>
                </div>
                <p className="mt-1 text-xs text-muted-foreground">
                  {zoneTypeLabel(zone.zone_type)} · {km.toFixed(1)} km from you
                  {zone.is_simulation ? " · simulation" : ""}
                </p>
                {zone.advisory && <p className="mt-2 text-sm">{zone.advisory}</p>}
              </div>
            ))}
            <Button asChild variant="destructive" size="sm">
              <Link to="/emergency">Open Emergency SOS</Link>
            </Button>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Your readiness</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex items-center justify-between text-sm">
            <span className="text-muted-foreground">
              {done} of {total} steps done
            </span>
            <span className="font-semibold">{readiness}%</span>
          </div>
          <Progress value={readiness} />
        </CardContent>
      </Card>

      {tasks.isLoading ? (
        <PanelSkeleton />
      ) : (
        <div className="grid gap-4 md:grid-cols-2">
          {groups.map(([category, list]) => (
            <Card key={category}>
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-base">
                  <ClipboardCheck className="size-5 text-primary" aria-hidden="true" />
                  {category}
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                {list.map((task) => (
                  <label
                    key={task.id}
                    className="flex cursor-pointer items-start gap-3 rounded-xl border border-border p-3"
                  >
                    <Checkbox
                      checked={task.done}
                      onCheckedChange={(checked) =>
                        toggle.mutate({ id: task.id, done: checked === true })
                      }
                      aria-label={task.label}
                    />
                    <span
                      className={`text-sm ${task.done ? "text-muted-foreground line-through" : ""}`}
                    >
                      {task.label}
                    </span>
                  </label>
                ))}
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Hazard advisories</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          {(zones.data ?? []).length === 0 ? (
            <p className="text-sm text-muted-foreground">
              No hazard advisory is active right now. Anything published will appear here and warn
              you if you are inside the area.
            </p>
          ) : (
            (zones.data ?? []).map((zone) => (
              <div key={zone.id} className="rounded-xl border border-border p-3">
                <div className="flex items-center justify-between gap-2">
                  <p className="truncate text-sm font-medium">{zone.name}</p>
                  <Badge variant="outline">{zoneSeverityLabel(zone.severity)}</Badge>
                </div>
                <p className="mt-1 text-xs text-muted-foreground">
                  {zoneTypeLabel(zone.zone_type)} · {zone.radius_km} km radius
                </p>
                {zone.advisory && <p className="mt-2 text-sm">{zone.advisory}</p>}
              </div>
            ))
          )}
        </CardContent>
      </Card>
    </div>
  );
}
