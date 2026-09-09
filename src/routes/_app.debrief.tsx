/**
 * Recovery & after-action report — the closing half of the disaster cycle.
 *
 * Pick an incident and this screen shows what actually happened: measured
 * response timings, the units that responded, the people involved, the hospital
 * handover, the full timeline, and the recovery follow-up work that still needs
 * doing. Nothing is estimated — a missing timestamp reads "Not recorded".
 */
import { useMemo, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ClipboardCheck, Download, FileText } from "lucide-react";
import { toast } from "sonner";
import { PageHeader } from "@/components/system/page-header";
import { EmptyState } from "@/components/system/empty-state";
import { PanelSkeleton } from "@/components/system/loading-skeletons";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Progress } from "@/components/ui/progress";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { assignmentsQuery, handoffsQuery, assignmentStatusLabel, resourceTypeLabel } from "@/lib/dispatch";
import {
  RECOVERY_STEPS,
  completedRecoverySteps,
  debriefIncidentsQuery,
  humanSeconds,
  incidentEventsQuery,
  incidentMetrics,
  incidentVictimsQuery,
  markRecoveryStep,
  type DebriefIncident,
  type RecoveryStepKey,
} from "@/lib/debrief";
import { isClosedPhase, phaseLabel, VICTIM_PRIORITIES, VICTIM_STATUSES } from "@/lib/incident";
import { exportIncidentReportPdf } from "@/lib/export-pdf";

export const Route = createFileRoute("/_app/debrief")({
  head: () => ({
    meta: [
      { title: "Recovery & incident report — RESQORA" },
      {
        name: "description",
        content:
          "Close out an incident with measured response times, responding units, hospital handover, recovery follow-up steps and a downloadable after-action report.",
      },
      { property: "og:title", content: "Recovery & incident report — RESQORA" },
      {
        property: "og:description",
        content:
          "After-action reporting and recovery follow-up for every RESQORA incident.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: DebriefPage,
});

function priorityLabel(value: string) {
  return VICTIM_PRIORITIES.find((entry) => entry.value === value)?.label ?? value;
}

function victimStatusLabel(value: string) {
  return VICTIM_STATUSES.find((entry) => entry.value === value)?.label ?? value;
}

function DebriefPage() {
  const queryClient = useQueryClient();
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const incidents = useQuery(debriefIncidentsQuery());
  const active = useMemo<DebriefIncident | null>(() => {
    const list = incidents.data ?? [];
    if (list.length === 0) return null;
    return list.find((incident) => incident.id === selectedId) ?? list[0];
  }, [incidents.data, selectedId]);
  const list = incidents.data ?? [];


  const events = useQuery(incidentEventsQuery(active?.id));
  const victims = useQuery(incidentVictimsQuery(active?.id));
  const assignments = useQuery(assignmentsQuery(active?.id));
  const handoffs = useQuery(handoffsQuery(active?.id));

  const eventList = events.data ?? [];
  const victimList = victims.data ?? [];
  const assignmentList = assignments.data ?? [];
  const handoffList = handoffs.data ?? [];

  const metrics = active
    ? incidentMetrics(active, eventList, assignmentList, handoffList)
    : null;
  const done = completedRecoverySteps(eventList);
  const recoveryProgress = Math.round((done.size / RECOVERY_STEPS.length) * 100);

  const completeStep = useMutation({
    mutationFn: async (step: RecoveryStepKey) => {
      if (!active) throw new Error("Pick an incident first.");
      await markRecoveryStep(active.id, step);
    },
    onSuccess: () => {
      toast.success("Recovery step recorded");
      void queryClient.invalidateQueries({ queryKey: ["incident-events", active?.id] });
    },
    onError: (error: Error) => toast.error(error.message),
  });

  const timingRows: Array<[string, string]> = metrics
    ? [
        ["Time to alert contacts", humanSeconds(metrics.timeToAlertSeconds)],
        ["Time to acknowledgement", humanSeconds(metrics.timeToAcknowledgeSeconds)],
        ["Time to first unit dispatched", humanSeconds(metrics.timeToDispatchSeconds)],
        ["Time to help on scene", humanSeconds(metrics.timeToOnSceneSeconds)],
        ["Time to hospital handover", humanSeconds(metrics.timeToHandoverSeconds)],
        ["Total incident duration", humanSeconds(metrics.totalDurationSeconds)],
        ["Escalations", String(metrics.escalations)],
        ["Units dispatched", `${metrics.unitsCompleted} of ${metrics.unitsDispatched} completed`],
      ]
    : [];

  function download() {
    if (!active || !metrics) return;
    exportIncidentReportPdf({
      incident: active,
      phaseLabel: phaseLabel(active.phase),
      metrics: timingRows,
      units: assignmentList.map((a) => [
        a.resource_name,
        resourceTypeLabel(a.resource_type),
        assignmentStatusLabel(a.status),
      ]),
      people: victimList.map((v) => [
        v.label,
        priorityLabel(v.priority),
        victimStatusLabel(v.status),
        v.hospital || "—",
      ]),
      handover: handoffList.flatMap((h) => {
        const rows: Array<[string, string]> = [["Hospital", h.hospital_name]];
        if (h.department) rows.push(["Department", h.department]);
        if (h.bed_or_ward) rows.push(["Bed or ward", h.bed_or_ward]);
        rows.push(["Status", h.status]);
        if (h.handover_notes) rows.push(["Notes", h.handover_notes]);
        return rows;
      }),
      recovery: RECOVERY_STEPS.map((step) => [
        step.label,
        done.has(step.key) ? "Done" : "Outstanding",
      ]),
      timeline: eventList.map((event) => [
        new Date(event.created_at).toLocaleString(),
        event.label,
        event.detail || "—",
      ]),
    });
    toast.success("Report downloaded");
  }

  return (
    <>
      <PageHeader
        icon={ClipboardCheck}
        title="Recovery & report"
        description="Close out an incident: measured response times, who responded, where care was handed over, the follow-up work that remains, and a report you can download or hand over."
      />

      {incidents.isLoading ? (
        <PanelSkeleton />
      ) : list.length === 0 ? (
        <EmptyState
          icon={FileText}
          title="No incidents yet"
          description="Once an emergency has been raised, its full after-action report appears here."
        />
      ) : (
        <div className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Choose an incident</CardTitle>
            </CardHeader>
            <CardContent className="flex flex-wrap gap-2">
              {list.map((incident) => {
                const isActive = active?.id === incident.id;
                return (
                  <button
                    key={incident.id}
                    type="button"
                    onClick={() => setSelectedId(incident.id)}
                    className={`rounded-lg border px-3 py-2 text-left text-sm transition ${
                      isActive ? "border-primary bg-primary/10" : "hover:bg-muted"
                    }`}
                  >
                    <span className="block font-medium">
                      {incident.public_code || incident.incident_type}
                    </span>
                    <span className="block text-xs text-muted-foreground">
                      {new Date(incident.started_at).toLocaleString()} · {phaseLabel(incident.phase)}
                      {incident.is_simulation ? " · Simulation" : ""}
                    </span>
                  </button>
                );
              })}
            </CardContent>
          </Card>

          {active && metrics && (
            <>
              <Card>
                <CardHeader className="flex flex-row items-start justify-between gap-3">
                  <div>
                    <CardTitle className="text-base">
                      {active.public_code || active.incident_type}
                    </CardTitle>
                    <p className="mt-1 text-xs text-muted-foreground">
                      {active.address ||
                        (active.latitude != null && active.longitude != null
                          ? `${active.latitude.toFixed(4)}, ${active.longitude.toFixed(4)}`
                          : "Location not recorded")}
                    </p>
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    {active.is_simulation && <Badge variant="outline">Simulation</Badge>}
                    {active.is_mass_casualty && <Badge variant="destructive">Mass casualty</Badge>}
                    <Badge variant={isClosedPhase(active.phase) ? "secondary" : "default"}>
                      {phaseLabel(active.phase)}
                    </Badge>
                  </div>
                </CardHeader>
                <CardContent className="space-y-3">
                  {(active.incident_description || active.ai_summary) && (
                    <p className="text-sm text-muted-foreground">
                      {active.incident_description || active.ai_summary}
                    </p>
                  )}
                  <Button onClick={download} className="gap-2">
                    <Download className="size-4" /> Download report
                  </Button>
                </CardContent>
              </Card>

              <Card>
                <CardHeader>
                  <CardTitle className="text-base">Response timings</CardTitle>
                </CardHeader>
                <CardContent className="grid gap-2 sm:grid-cols-2">
                  {timingRows.map(([label, value]) => (
                    <div key={label} className="rounded-lg border p-3">
                      <p className="text-xs text-muted-foreground">{label}</p>
                      <p className="text-sm font-semibold">{value}</p>
                    </div>
                  ))}
                </CardContent>
              </Card>

              <Card>
                <CardHeader>
                  <CardTitle className="text-base">Recovery follow-up</CardTitle>
                </CardHeader>
                <CardContent className="space-y-3">
                  <div className="space-y-1">
                    <Progress value={recoveryProgress} />
                    <p className="text-xs text-muted-foreground">
                      {done.size} of {RECOVERY_STEPS.length} steps done
                    </p>
                  </div>
                  {RECOVERY_STEPS.map((step) => {
                    const complete = done.has(step.key);
                    return (
                      <label
                        key={step.key}
                        className="flex items-start gap-3 rounded-lg border p-3 text-sm"
                      >
                        <Checkbox
                          checked={complete}
                          disabled={complete || completeStep.isPending}
                          onCheckedChange={(value) => {
                            if (value) completeStep.mutate(step.key);
                          }}
                        />
                        <span>
                          <span className={complete ? "line-through" : "font-medium"}>
                            {step.label}
                          </span>
                          <span className="block text-xs text-muted-foreground">{step.detail}</span>
                        </span>
                      </label>
                    );
                  })}
                </CardContent>
              </Card>

              <Card>
                <CardHeader>
                  <CardTitle className="text-base">Who responded</CardTitle>
                </CardHeader>
                <CardContent className="space-y-2">
                  {assignmentList.length === 0 ? (
                    <p className="text-sm text-muted-foreground">No unit was dispatched.</p>
                  ) : (
                    assignmentList.map((a) => (
                      <div
                        key={a.id}
                        className="flex items-center justify-between rounded-lg border p-3 text-sm"
                      >
                        <span>
                          <span className="font-medium">{a.resource_name}</span>
                          <span className="block text-xs text-muted-foreground">
                            {resourceTypeLabel(a.resource_type)}
                            {a.eta_minutes != null ? ` · ETA ${a.eta_minutes} min` : ""}
                          </span>
                        </span>
                        <Badge variant="outline">{assignmentStatusLabel(a.status)}</Badge>
                      </div>
                    ))
                  )}
                </CardContent>
              </Card>

              <Card>
                <CardHeader>
                  <CardTitle className="text-base">People involved</CardTitle>
                </CardHeader>
                <CardContent className="space-y-2">
                  {victimList.length === 0 ? (
                    <p className="text-sm text-muted-foreground">No individual records.</p>
                  ) : (
                    victimList.map((v) => (
                      <div
                        key={v.id}
                        className="flex items-center justify-between rounded-lg border p-3 text-sm"
                      >
                        <span>
                          <span className="font-medium">{v.label}</span>
                          <span className="block text-xs text-muted-foreground">
                            {victimStatusLabel(v.status)}
                            {v.hospital ? ` · ${v.hospital}` : ""}
                          </span>
                        </span>
                        <Badge variant="outline">{priorityLabel(v.priority)}</Badge>
                      </div>
                    ))
                  )}
                </CardContent>
              </Card>

              <Card>
                <CardHeader>
                  <CardTitle className="text-base">Hospital handover</CardTitle>
                </CardHeader>
                <CardContent className="space-y-2">
                  {handoffList.length === 0 ? (
                    <p className="text-sm text-muted-foreground">No handover recorded.</p>
                  ) : (
                    handoffList.map((h) => (
                      <div key={h.id} className="rounded-lg border p-3 text-sm">
                        <p className="font-medium">{h.hospital_name}</p>
                        <p className="text-xs text-muted-foreground">
                          {[h.department, h.bed_or_ward, h.status].filter(Boolean).join(" · ")}
                        </p>
                        {h.handover_notes && <p className="mt-1 text-xs">{h.handover_notes}</p>}
                      </div>
                    ))
                  )}
                </CardContent>
              </Card>

              <Card>
                <CardHeader>
                  <CardTitle className="text-base">Full timeline</CardTitle>
                </CardHeader>
                <CardContent className="space-y-2">
                  {events.isLoading ? (
                    <PanelSkeleton />
                  ) : eventList.length === 0 ? (
                    <p className="text-sm text-muted-foreground">No timeline entries.</p>
                  ) : (
                    eventList.map((event) => (
                      <div key={event.id} className="rounded-lg border p-3 text-sm">
                        <p className="font-medium">{event.label}</p>
                        <p className="text-xs text-muted-foreground">
                          {new Date(event.created_at).toLocaleString()}
                        </p>
                        {event.detail && <p className="mt-1 text-xs">{event.detail}</p>}
                      </div>
                    ))
                  )}
                </CardContent>
              </Card>
            </>
          )}
        </div>
      )}
    </>
  );
}
