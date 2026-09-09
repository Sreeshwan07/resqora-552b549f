import { useMemo, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { queryOptions, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Ambulance,
  Building2,
  CircleAlert,
  LayoutDashboard,
  Radio,
  Send,
  Users,
} from "lucide-react";
import { toast } from "sonner";
import { PageHeader } from "@/components/system/page-header";
import { EmptyState } from "@/components/system/empty-state";
import { PanelSkeleton } from "@/components/system/loading-skeletons";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/use-auth";
import { isClosedPhase, phaseLabel } from "@/lib/incident";
import {
  ASSIGNMENT_STATUSES,
  assignmentStatusLabel,
  assignmentsQuery,
  dispatchResource,
  handoffsQuery,
  recordHospitalHandoff,
  resourceStatusLabel,
  resourceTypeLabel,
  resourcesQuery,
  setAssignmentStatus,
  type AssignmentStatus,
} from "@/lib/dispatch";
import { zonesQuery, zoneSeverityLabel, zoneTypeLabel } from "@/lib/prepare";
import { SituationMap, type MapPoint } from "@/components/resqora/situation-map";
import { ResponseAnalytics } from "@/components/resqora/response-analytics";
import { useRealtimeTables } from "@/hooks/use-realtime-tables";
import { locationSourceLabel } from "@/lib/sms-sos";
import { emergencyVolunteersQuery, skillLabels } from "@/lib/volunteers";

const REFRESH_MS = 10_000;

type CommandIncident = {
  id: string;
  public_code: string | null;
  type: string;
  severity: string;
  phase: string;
  status: string;
  victim_count: number;
  is_mass_casualty: boolean;
  is_simulation: boolean;
  latitude: number | null;
  longitude: number | null;
  responder_status: string | null;
  hospital_status: string | null;
  address: string | null;
  started_at: string;
  source: string | null;
  location_source: string | null;
};

/** Incidents the signed-in person is allowed to see (their own, or all for an admin). */
const commandIncidentsQuery = (userId: string | undefined) =>
  queryOptions({
    queryKey: ["command-incidents", userId],
    enabled: Boolean(userId),
    refetchInterval: REFRESH_MS,
    queryFn: async (): Promise<CommandIncident[]> => {
      const { data, error } = await supabase
        .from("emergencies")
        .select(
          "id, public_code, type, severity, phase, status, victim_count, is_mass_casualty, is_simulation, responder_status, hospital_status, address, started_at, latitude, longitude, source, location_source",
        )
        .order("started_at", { ascending: false })
        .limit(40);
      if (error) throw new Error(error.message);
      return (data ?? []) as CommandIncident[];
    },
  });

export const Route = createFileRoute("/_app/command-center")({
  head: () => ({
    meta: [
      { title: "Command Centre — RESQORA" },
      {
        name: "description",
        content:
          "Coordinate live incidents in RESQORA: dispatch ambulances and rescue teams, track responder progress, record hospital handover and watch active hazard zones.",
      },
      { property: "og:title", content: "RESQORA Command Centre" },
      {
        property: "og:description",
        content: "Live incident coordination, dispatch and hospital handover in one screen.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: CommandCentrePage,
});

function CommandCentrePage() {
  const { user } = useAuth();
  const incidents = useQuery(commandIncidentsQuery(user?.id));
  const resources = useQuery({ ...resourcesQuery(), refetchInterval: REFRESH_MS });
  const zones = useQuery(zonesQuery());
  const [selectedId, setSelectedId] = useState<string | null>(null);

  // Incidents raised in the app or by SMS, dispatch changes and volunteer
  // answers all arrive live from the database.
  useRealtimeTables({
    channel: user?.id ? `command-centre-${user.id}` : null,
    enabled: Boolean(user?.id),
    watch: [
      { table: "emergencies" },
      { table: "incident_assignments" },
      { table: "volunteer_incident_matches" },
      { table: "emergency_events" },
    ],
    invalidate: [
      "command-incidents",
      "response-resources",
      "incident-assignments",
      "emergency-volunteers",
      "emergency-events",
    ],
  });

  const live = useMemo(
    () => (incidents.data ?? []).filter((incident) => !isClosedPhase(incident.phase)),
    [incidents.data],
  );
  const closed = useMemo(
    () => (incidents.data ?? []).filter((incident) => isClosedPhase(incident.phase)),
    [incidents.data],
  );
  const selected = useMemo(() => {
    const list = incidents.data ?? [];
    return list.find((incident) => incident.id === selectedId) ?? live[0] ?? null;
  }, [incidents.data, live, selectedId]);

  const available = (resources.data ?? []).filter((resource) => resource.status === "available");
  const committed = (resources.data ?? []).filter((resource) => resource.status !== "available");
  const peopleInvolved = live.reduce((total, incident) => total + (incident.victim_count || 0), 0);

  const mapPoints: MapPoint[] = useMemo(() => {
    const points: MapPoint[] = [];
    for (const incident of live) {
      if (incident.latitude === null || incident.longitude === null) continue;
      points.push({
        id: incident.id,
        label: incident.public_code ?? incident.type,
        latitude: incident.latitude,
        longitude: incident.longitude,
        kind: "incident",
      });
    }
    for (const resource of resources.data ?? []) {
      if (resource.latitude === null || resource.longitude === null) continue;
      points.push({
        id: resource.id,
        label: resource.name,
        latitude: resource.latitude,
        longitude: resource.longitude,
        kind: "resource",
        muted: resource.status !== "available",
      });
    }
    for (const zone of zones.data ?? []) {
      points.push({
        id: zone.id,
        label: zone.name,
        latitude: zone.latitude,
        longitude: zone.longitude,
        kind: "zone",
        radiusKm: zone.radius_km,
      });
    }
    return points;
  }, [live, resources.data, zones.data]);

  return (
    <div className="space-y-6">
      <PageHeader
        icon={LayoutDashboard}
        title="Command Centre"
        description="One place to see every live incident, send the right help, and follow it through to hospital handover."
      />

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Stat icon={CircleAlert} label="Live incidents" value={live.length} />
        <Stat icon={Users} label="People involved" value={peopleInvolved} />
        <Stat icon={Ambulance} label="Help available" value={available.length} />
        <Stat icon={Radio} label="Hazard zones" value={(zones.data ?? []).length} />
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Situation map</CardTitle>
        </CardHeader>
        <CardContent>
          <SituationMap points={mapPoints} />
        </CardContent>
      </Card>

      <div className="grid gap-6 lg:grid-cols-[minmax(0,340px)_minmax(0,1fr)]">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Incidents</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {incidents.isLoading ? (
              <PanelSkeleton />
            ) : live.length === 0 && closed.length === 0 ? (
              <EmptyState
                icon={CircleAlert}
                title="No incidents yet"
                description="Incidents you open, or that a bystander opens for you, appear here the moment they start."
              />
            ) : (
              <>
                {[...live, ...closed.slice(0, 8)].map((incident) => (
                  <button
                    key={incident.id}
                    type="button"
                    onClick={() => setSelectedId(incident.id)}
                    className={`w-full rounded-xl border p-3 text-left transition ${
                      selected?.id === incident.id
                        ? "border-primary bg-primary/5"
                        : "border-border hover:bg-accent"
                    }`}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="truncate text-sm font-semibold">
                        {incident.public_code ?? incident.id.slice(0, 8).toUpperCase()}
                      </span>
                      <Badge variant={isClosedPhase(incident.phase) ? "secondary" : "destructive"}>
                        {phaseLabel(incident.phase)}
                      </Badge>
                    </div>
                    <p className="mt-1 truncate text-xs text-muted-foreground">
                      {incident.type} · {incident.severity}
                      {incident.victim_count > 1 ? ` · ${incident.victim_count} people` : ""}
                      {incident.address ? ` · ${incident.address}` : ""}
                    </p>
                    <div className="mt-2 flex flex-wrap gap-1">
                      {incident.source === "sms" && <Badge variant="outline">SMS</Badge>}
                      {incident.location_source && (
                        <Badge variant="outline">
                          {locationSourceLabel(incident.location_source)}
                        </Badge>
                      )}
                      {incident.is_mass_casualty && <Badge variant="outline">Mass casualty</Badge>}
                      {incident.is_simulation && <Badge variant="outline">Simulation</Badge>}
                    </div>
                  </button>
                ))}
              </>
            )}
          </CardContent>
        </Card>

        <div className="space-y-6">
          {selected ? (
            <>
              <DispatchPanel incident={selected} />
              <HandoffPanel incident={selected} />
            </>
          ) : (
            <EmptyState
              icon={Send}
              title="Nothing to coordinate"
              description="Select an incident on the left to send help and record hospital handover."
            />
          )}

          <Card>
            <CardHeader>
              <CardTitle className="text-base">Response resources</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
              {resources.isLoading ? (
                <PanelSkeleton />
              ) : (resources.data ?? []).length === 0 ? (
                <EmptyState
                  icon={Ambulance}
                  title="No resources listed yet"
                  description="Ambulances, fire, police and rescue teams added by an administrator show up here with their live status."
                />
              ) : (
                [...available, ...committed].map((resource) => (
                  <div
                    key={resource.id}
                    className="flex items-center justify-between gap-3 rounded-xl border border-border p-3"
                  >
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium">
                        {resource.name}
                        {resource.identifier ? ` · ${resource.identifier}` : ""}
                      </p>
                      <p className="truncate text-xs text-muted-foreground">
                        {resourceTypeLabel(resource.resource_type)}
                        {resource.base_location ? ` · ${resource.base_location}` : ""}
                      </p>
                    </div>
                    <Badge variant={resource.status === "available" ? "secondary" : "outline"}>
                      {resourceStatusLabel(resource.status)}
                    </Badge>
                  </div>
                ))
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">Active hazard zones</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
              {(zones.data ?? []).length === 0 ? (
                <p className="text-sm text-muted-foreground">
                  No hazard advisory is active right now.
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
                      {zone.is_simulation ? " · simulation" : ""}
                    </p>
                    {zone.advisory && <p className="mt-2 text-sm">{zone.advisory}</p>}
                  </div>
                ))
              )}
            </CardContent>
          </Card>
        </div>
      </div>

      <ResponseAnalytics userId={user?.id} />
    </div>
  );
}

function Stat({
  icon: Icon,
  label,
  value,
}: {
  icon: typeof Users;
  label: string;
  value: number;
}) {
  return (
    <div className="flex items-center gap-3 rounded-2xl border border-border bg-card p-4">
      <span className="grid size-10 place-items-center rounded-xl bg-accent text-accent-foreground">
        <Icon className="size-5" aria-hidden="true" />
      </span>
      <div>
        <p className="text-xl font-semibold">{value}</p>
        <p className="text-xs text-muted-foreground">{label}</p>
      </div>
    </div>
  );
}

function DispatchPanel({ incident }: { incident: CommandIncident }) {
  const queryClient = useQueryClient();
  const resources = useQuery(resourcesQuery());
  const assignments = useQuery({
    ...assignmentsQuery(incident.id),
    refetchInterval: REFRESH_MS,
  });
  const volunteers = useQuery(emergencyVolunteersQuery(incident.id));
  const [resourceId, setResourceId] = useState("");
  const [eta, setEta] = useState("");

  const communityAccepted = (volunteers.data ?? []).filter(
    (v) => v.status === "accepted" || v.status === "completed",
  );
  const communityPending = (volunteers.data ?? []).filter((v) => v.status === "offered");

  const options = (resources.data ?? []).filter(
    (resource) =>
      resource.status === "available" || resource.assigned_emergency_id === incident.id,
  );

  async function refresh() {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ["incident-assignments", incident.id] }),
      queryClient.invalidateQueries({ queryKey: ["response-resources"] }),
      queryClient.invalidateQueries({ queryKey: ["command-incidents"] }),
      queryClient.invalidateQueries({ queryKey: ["emergency-events", incident.id] }),
    ]);
  }

  const dispatch = useMutation({
    mutationFn: () =>
      dispatchResource(incident.id, resourceId, eta ? Number(eta) : null, null),
    onSuccess: async (result) => {
      setResourceId("");
      setEta("");
      toast.success(`${result.resource} is on the way`);
      await refresh();
    },
    onError: (error: Error) => toast.error(error.message),
  });

  const update = useMutation({
    mutationFn: (input: { id: string; status: AssignmentStatus }) =>
      setAssignmentStatus(input.id, input.status),
    onSuccess: async () => {
      toast.success("Assignment updated");
      await refresh();
    },
    onError: (error: Error) => toast.error(error.message),
  });

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">
          Send help — {incident.public_code ?? incident.id.slice(0, 8).toUpperCase()}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="rounded-xl border border-border p-3 text-xs text-muted-foreground">
          <p>
            Reported via {incident.source === "sms" ? "SMS" : "the app"} ·{" "}
            {incident.address ?? "location not recorded"} (
            {locationSourceLabel(incident.location_source)})
          </p>
          <p className="mt-1">
            Community response:{" "}
            {communityAccepted.length > 0
              ? communityAccepted
                  .map(
                    (v) =>
                      `${v.volunteer_name} (${skillLabels(v.skills).join(", ") || "volunteer"}${
                        v.distance_km != null ? `, ${v.distance_km} km` : ""
                      })`,
                  )
                  .join("; ")
              : communityPending.length > 0
                ? `${communityPending.length} volunteer(s) asked — awaiting an answer`
                : "no verified community responder accepted"}
          </p>
        </div>
        <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_120px_auto] sm:items-end">
          <div className="space-y-1.5">
            <Label htmlFor="resource">Available help</Label>
            <Select value={resourceId} onValueChange={setResourceId}>
              <SelectTrigger id="resource">
                <SelectValue placeholder="Choose an ambulance or team" />
              </SelectTrigger>
              <SelectContent>
                {options.length === 0 ? (
                  <SelectItem value="none" disabled>
                    Nothing free right now
                  </SelectItem>
                ) : (
                  options.map((resource) => (
                    <SelectItem key={resource.id} value={resource.id}>
                      {resource.name} · {resourceTypeLabel(resource.resource_type)}
                    </SelectItem>
                  ))
                )}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="eta">Arrives in (min)</Label>
            <Input
              id="eta"
              inputMode="numeric"
              value={eta}
              onChange={(event) => setEta(event.target.value.replace(/\D/g, ""))}
              placeholder="12"
            />
          </div>
          <Button
            onClick={() => dispatch.mutate()}
            disabled={!resourceId || resourceId === "none" || dispatch.isPending}
          >
            <Send className="mr-2 size-4" aria-hidden="true" />
            Dispatch
          </Button>
        </div>

        <div className="space-y-2">
          {(assignments.data ?? []).length === 0 ? (
            <p className="text-sm text-muted-foreground">
              No help has been assigned to this incident yet.
            </p>
          ) : (
            (assignments.data ?? []).map((assignment) => (
              <div
                key={assignment.id}
                className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-border p-3"
              >
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium">{assignment.resource_name}</p>
                  <p className="text-xs text-muted-foreground">
                    {resourceTypeLabel(assignment.resource_type)}
                    {assignment.eta_minutes ? ` · ETA ${assignment.eta_minutes} min` : ""}
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <Badge variant="outline">{assignmentStatusLabel(assignment.status)}</Badge>
                  <Select
                    value={assignment.status}
                    onValueChange={(value) =>
                      update.mutate({ id: assignment.id, status: value as AssignmentStatus })
                    }
                  >
                    <SelectTrigger className="w-[150px]">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {ASSIGNMENT_STATUSES.map((status) => (
                        <SelectItem key={status.value} value={status.value}>
                          {status.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>
            ))
          )}
        </div>
      </CardContent>
    </Card>
  );
}

function HandoffPanel({ incident }: { incident: CommandIncident }) {
  const queryClient = useQueryClient();
  const handoffs = useQuery(handoffsQuery(incident.id));
  const [hospital, setHospital] = useState("");
  const [department, setDepartment] = useState("");
  const [bed, setBed] = useState("");

  const record = useMutation({
    mutationFn: () =>
      recordHospitalHandoff({
        emergencyId: incident.id,
        hospital,
        department: department || null,
        bed: bed || null,
      }),
    onSuccess: async () => {
      setHospital("");
      setDepartment("");
      setBed("");
      toast.success("Hospital handover recorded");
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["hospital-handoffs", incident.id] }),
        queryClient.invalidateQueries({ queryKey: ["command-incidents"] }),
        queryClient.invalidateQueries({ queryKey: ["emergency-events", incident.id] }),
      ]);
    },
    onError: (error: Error) => toast.error(error.message),
  });

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Hospital handover</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid gap-3 sm:grid-cols-3">
          <div className="space-y-1.5">
            <Label htmlFor="hospital">Hospital</Label>
            <Input
              id="hospital"
              value={hospital}
              onChange={(event) => setHospital(event.target.value)}
              placeholder="City General Hospital"
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="department">Department</Label>
            <Input
              id="department"
              value={department}
              onChange={(event) => setDepartment(event.target.value)}
              placeholder="Emergency / Trauma"
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="bed">Bed or ward</Label>
            <Input
              id="bed"
              value={bed}
              onChange={(event) => setBed(event.target.value)}
              placeholder="Bay 3"
            />
          </div>
        </div>
        <Button
          onClick={() => record.mutate()}
          disabled={!hospital.trim() || record.isPending}
          variant="secondary"
        >
          <Building2 className="mr-2 size-4" aria-hidden="true" />
          Record handover
        </Button>

        <div className="space-y-2">
          {(handoffs.data ?? []).length === 0 ? (
            <p className="text-sm text-muted-foreground">No handover recorded yet.</p>
          ) : (
            (handoffs.data ?? []).map((handoff) => (
              <div key={handoff.id} className="rounded-xl border border-border p-3">
                <div className="flex items-center justify-between gap-2">
                  <p className="truncate text-sm font-medium">{handoff.hospital_name}</p>
                  <Badge variant="outline">{handoff.status}</Badge>
                </div>
                <p className="mt-1 text-xs text-muted-foreground">
                  {[handoff.department, handoff.bed_or_ward].filter(Boolean).join(" · ") ||
                    "Details to follow"}
                </p>
              </div>
            ))
          )}
        </div>
      </CardContent>
    </Card>
  );
}
