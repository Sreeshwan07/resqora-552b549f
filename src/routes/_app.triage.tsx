/**
 * Triage board — mass-casualty view across every live incident the signed-in
 * person can see. People are grouped by triage priority so the most urgent are
 * always at the top, and priority/status/hospital changes write straight to the
 * incident record and its timeline (RLS keeps this to the incident owner,
 * an admin, or an assigned responder).
 */
import { useMemo, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { queryOptions, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { HeartPulse, Users } from "lucide-react";
import { toast } from "sonner";
import { PageHeader } from "@/components/system/page-header";
import { EmptyState } from "@/components/system/empty-state";
import { PanelSkeleton } from "@/components/system/loading-skeletons";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
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
import {
  VICTIM_PRIORITIES,
  VICTIM_STATUSES,
  isClosedPhase,
  phaseLabel,
  updateVictim,
  type IncidentVictim,
} from "@/lib/incident";

const PRIORITY_ORDER = VICTIM_PRIORITIES.map((entry) => entry.value);

type BoardIncident = {
  id: string;
  public_code: string | null;
  type: string;
  phase: string;
  is_simulation: boolean;
  is_mass_casualty: boolean;
  address: string | null;
};

const boardQuery = (userId: string | undefined) =>
  queryOptions({
    queryKey: ["triage-board", userId],
    enabled: Boolean(userId),
    refetchInterval: 15_000,
    queryFn: async (): Promise<{ incidents: BoardIncident[]; victims: IncidentVictim[] }> => {
      const { data: incidents, error } = await supabase
        .from("emergencies")
        .select("id, public_code, type, phase, is_simulation, is_mass_casualty, address")
        .order("started_at", { ascending: false })
        .limit(40);
      if (error) throw new Error(error.message);
      const live = ((incidents ?? []) as BoardIncident[]).filter(
        (incident) => !isClosedPhase(incident.phase),
      );
      if (live.length === 0) return { incidents: [], victims: [] };
      const { data: victims, error: victimError } = await supabase
        .from("emergency_victims")
        .select("*")
        .in(
          "emergency_id",
          live.map((incident) => incident.id),
        )
        .order("created_at", { ascending: true });
      if (victimError) throw new Error(victimError.message);
      return { incidents: live, victims: (victims ?? []) as IncidentVictim[] };
    },
  });

export const Route = createFileRoute("/_app/triage")({
  head: () => ({
    meta: [
      { title: "Triage board — RESQORA" },
      {
        name: "description",
        content:
          "Mass-casualty triage board in RESQORA: everyone involved in live incidents, sorted by priority, with status and receiving hospital.",
      },
      { property: "og:title", content: "RESQORA triage board" },
      {
        property: "og:description",
        content: "Sort everyone involved in live incidents by triage priority and track each person.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: TriagePage,
});

function TriagePage() {
  const { user } = useAuth();
  const board = useQuery(boardQuery(user?.id));
  const [filter, setFilter] = useState("all");

  const incidentsById = useMemo(
    () => new Map((board.data?.incidents ?? []).map((incident) => [incident.id, incident])),
    [board.data],
  );

  const victims = useMemo(() => {
    const list = board.data?.victims ?? [];
    const filtered = filter === "all" ? list : list.filter((victim) => victim.priority === filter);
    return [...filtered].sort(
      (a, b) => PRIORITY_ORDER.indexOf(a.priority as never) - PRIORITY_ORDER.indexOf(b.priority as never),
    );
  }, [board.data, filter]);

  const counts = useMemo(() => {
    const list = board.data?.victims ?? [];
    return VICTIM_PRIORITIES.map((priority) => ({
      ...priority,
      count: list.filter((victim) => victim.priority === priority.value).length,
    }));
  }, [board.data]);

  return (
    <div className="space-y-6">
      <PageHeader
        icon={HeartPulse}
        title="Triage board"
        description="Everyone involved in live incidents, most urgent first, with where each person is going."
      />

      <div className="grid gap-3 sm:grid-cols-3 lg:grid-cols-6">
        {counts.map((entry) => (
          <button
            key={entry.value}
            type="button"
            onClick={() => setFilter(filter === entry.value ? "all" : entry.value)}
            className={`rounded-2xl border p-3 text-left transition ${
              filter === entry.value ? "border-primary bg-primary/5" : "border-border hover:bg-accent"
            }`}
          >
            <p className={`text-xl font-semibold ${entry.tone}`}>{entry.count}</p>
            <p className="text-xs text-muted-foreground">{entry.label}</p>
          </button>
        ))}
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">
            People involved{filter === "all" ? "" : ` · ${filter}`}
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {board.isLoading ? (
            <PanelSkeleton />
          ) : victims.length === 0 ? (
            <EmptyState
              icon={Users}
              title="Nobody on the board"
              description="Add the people involved from an incident's Emergency screen, and they appear here sorted by how urgent they are."
            />
          ) : (
            victims.map((victim) => (
              <VictimRow
                key={victim.id}
                victim={victim}
                incident={incidentsById.get(victim.emergency_id) ?? null}
              />
            ))
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function VictimRow({
  victim,
  incident,
}: {
  victim: IncidentVictim;
  incident: BoardIncident | null;
}) {
  const queryClient = useQueryClient();
  const [hospital, setHospital] = useState(victim.hospital ?? "");

  const patch = useMutation({
    mutationFn: (changes: Parameters<typeof updateVictim>[1]) => updateVictim(victim, changes),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["triage-board"] });
      await queryClient.invalidateQueries({ queryKey: ["incident-victims", victim.emergency_id] });
    },
    onError: (error: Error) => toast.error(error.message),
  });

  const tone =
    VICTIM_PRIORITIES.find((entry) => entry.value === victim.priority)?.tone ??
    "text-muted-foreground";

  return (
    <div className="rounded-xl border border-border p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="min-w-0">
          <p className={`truncate text-sm font-semibold ${tone}`}>{victim.label}</p>
          <p className="truncate text-xs text-muted-foreground">
            {incident
              ? `${incident.public_code ?? incident.id.slice(0, 8).toUpperCase()} · ${incident.type} · ${phaseLabel(incident.phase)}`
              : "Incident"}
            {incident?.address ? ` · ${incident.address}` : ""}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {incident?.is_simulation && <Badge variant="outline">Simulation</Badge>}
          <Select
            value={victim.priority}
            onValueChange={(value) => patch.mutate({ priority: value })}
          >
            <SelectTrigger className="w-[140px]" aria-label="Priority">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {VICTIM_PRIORITIES.map((entry) => (
                <SelectItem key={entry.value} value={entry.value}>
                  {entry.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select value={victim.status} onValueChange={(value) => patch.mutate({ status: value })}>
            <SelectTrigger className="w-[170px]" aria-label="Status">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {VICTIM_STATUSES.map((entry) => (
                <SelectItem key={entry.value} value={entry.value}>
                  {entry.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Input
            value={hospital}
            onChange={(event) => setHospital(event.target.value)}
            onBlur={() => {
              if ((victim.hospital ?? "") !== hospital)
                patch.mutate({ hospital: hospital.trim() || null });
            }}
            placeholder="Receiving hospital"
            className="w-[190px]"
            aria-label="Receiving hospital"
          />
        </div>
      </div>
      {victim.notes && <p className="mt-2 text-sm text-muted-foreground">{victim.notes}</p>}
    </div>
  );
}
