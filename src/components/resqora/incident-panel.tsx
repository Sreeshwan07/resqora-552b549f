/**
 * Incident lifecycle + people involved.
 *
 * Every control here calls the server: the phase stepper goes through the
 * `transition_emergency` function (which refuses backwards or unauthorised
 * moves) and the people list writes to `emergency_victims`, keeping the
 * incident's headcount and mass-casualty flag in sync.
 */
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Loader2, Plus, Trash2, Users } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import {
  INCIDENT_PHASES,
  VICTIM_PRIORITIES,
  VICTIM_STATUSES,
  addVictim,
  isClosedPhase,
  listVictims,
  phaseLabel,
  phaseRank,
  removeVictim,
  setMassCasualty,
  transitionIncident,
  updateVictim,
  type IncidentVictim,
} from "@/lib/incident";

type IncidentLike = {
  id: string;
  user_id: string;
  phase: string;
  public_code: string | null;
  victim_count: number;
  is_mass_casualty: boolean;
  responder_status: string;
  hospital_status: string;
};

export function IncidentPanel({ incident }: { incident: IncidentLike }) {
  const queryClient = useQueryClient();
  const [newLabel, setNewLabel] = useState("");
  const [newPriority, setNewPriority] = useState("unknown");
  const closed = isClosedPhase(incident.phase);
  const currentRank = phaseRank(incident.phase);
  const nextPhase = INCIDENT_PHASES[currentRank + 1];

  const victims = useQuery({
    queryKey: ["incident-victims", incident.id],
    queryFn: () => listVictims(incident.id),
  });

  function refresh() {
    void queryClient.invalidateQueries({ queryKey: ["incident-victims", incident.id] });
    void queryClient.invalidateQueries({ queryKey: ["active-emergency"] });
    void queryClient.invalidateQueries({ queryKey: ["emergency-events"] });
  }

  const advance = useMutation({
    mutationFn: async () => {
      if (!nextPhase) throw new Error("This incident is already at its final step.");
      return transitionIncident(incident.id, nextPhase.key, nextPhase.detail);
    },
    onSuccess: (result) => {
      if (result.changed) toast.success(`Incident moved to ${phaseLabel(result.phase)}`);
      else toast.info(`Incident stayed at ${phaseLabel(result.phase)}`);
      refresh();
    },
    onError: (error: Error) => toast.error(error.message),
  });

  const addPerson = useMutation({
    mutationFn: () =>
      addVictim({
        emergencyId: incident.id,
        userId: incident.user_id,
        label: newLabel,
        priority: newPriority,
      }),
    onSuccess: () => {
      setNewLabel("");
      setNewPriority("unknown");
      refresh();
    },
    onError: (error: Error) => toast.error(error.message),
  });

  const patchPerson = useMutation({
    mutationFn: ({ victim, patch }: { victim: IncidentVictim; patch: Partial<IncidentVictim> }) =>
      updateVictim(victim, patch),
    onSuccess: refresh,
    onError: (error: Error) => toast.error(error.message),
  });

  const dropPerson = useMutation({
    mutationFn: (victim: IncidentVictim) => removeVictim(victim),
    onSuccess: refresh,
    onError: (error: Error) => toast.error(error.message),
  });

  const massCasualty = useMutation({
    mutationFn: (enabled: boolean) => setMassCasualty(incident.id, enabled),
    onSuccess: refresh,
    onError: (error: Error) => toast.error(error.message),
  });

  return (
    <div className="glass-panel space-y-5 rounded-2xl p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-sm font-semibold text-foreground">Incident lifecycle</h2>
          <p className="mt-0.5 text-xs text-muted-foreground">
            Reference {incident.public_code ?? incident.id.slice(0, 8).toUpperCase()} · currently{" "}
            <span className="font-semibold text-foreground">{phaseLabel(incident.phase)}</span>
          </p>
        </div>
        {!closed && nextPhase && (
          <Button size="sm" onClick={() => advance.mutate()} disabled={advance.isPending}>
            {advance.isPending && <Loader2 className="size-4 animate-spin" />}
            Move to {nextPhase.label}
          </Button>
        )}
      </div>

      <ol className="space-y-3">
        {INCIDENT_PHASES.slice(1).map((step, index) => {
          const done = phaseRank(step.key) <= currentRank;
          const active = step.key === incident.phase;
          return (
            <li key={step.key} className="flex gap-3">
              <span className="flex flex-col items-center">
                <span
                  className={
                    active
                      ? "size-3 rounded-full bg-alert ring-4 ring-alert/20"
                      : done
                        ? "size-3 rounded-full bg-alert"
                        : "size-3 rounded-full bg-muted-foreground/30"
                  }
                  aria-hidden="true"
                />
                {index < INCIDENT_PHASES.length - 2 && <span className="mt-1 h-6 w-px bg-border" />}
              </span>
              <div className="min-w-0 pb-0.5">
                <p
                  className={
                    done ? "text-sm font-medium text-foreground" : "text-sm text-muted-foreground"
                  }
                >
                  {step.label}
                </p>
                {active && <p className="text-xs text-muted-foreground">{step.detail}</p>}
              </div>
            </li>
          );
        })}
      </ol>

      <div className="grid gap-2 rounded-2xl border border-border p-4 sm:grid-cols-3">
        <Detail label="Responder" value={labelise(incident.responder_status)} />
        <Detail label="Hospital" value={labelise(incident.hospital_status)} />
        <Detail label="People involved" value={String(incident.victim_count)} />
      </div>

      <div className="flex items-center justify-between gap-3 rounded-2xl border border-border p-4">
        <div className="min-w-0">
          <p className="flex items-center gap-2 text-sm font-medium text-foreground">
            <Users className="size-4" aria-hidden="true" />
            Mass casualty incident
          </p>
          <p className="text-xs text-muted-foreground">
            Turn on for multi-victim events such as a bus crash, fire or collapse.
          </p>
        </div>
        <Switch
          checked={incident.is_mass_casualty}
          onCheckedChange={(value) => massCasualty.mutate(value)}
          aria-label="Mass casualty incident"
        />
      </div>

      <div className="space-y-3">
        <h3 className="text-sm font-semibold text-foreground">People involved</h3>
        {victims.isLoading && <p className="text-xs text-muted-foreground">Loading…</p>}
        {victims.data?.length === 0 && (
          <p className="text-xs text-muted-foreground">
            No one added yet. Add each person so their priority and status can be tracked
            separately.
          </p>
        )}
        <ul className="space-y-2">
          {(victims.data ?? []).map((victim) => (
            <li key={victim.id} className="rounded-2xl border border-border p-3">
              <div className="flex items-center justify-between gap-2">
                <p className="truncate text-sm font-medium text-foreground">{victim.label}</p>
                <Button
                  variant="ghost"
                  size="icon"
                  aria-label={`Remove ${victim.label}`}
                  onClick={() => dropPerson.mutate(victim)}
                >
                  <Trash2 className="size-4" aria-hidden="true" />
                </Button>
              </div>
              <div className="mt-2 grid gap-2 sm:grid-cols-2">
                <Select
                  value={victim.priority}
                  onValueChange={(priority) => patchPerson.mutate({ victim, patch: { priority } })}
                >
                  <SelectTrigger className="h-10 rounded-xl" aria-label="Priority">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {VICTIM_PRIORITIES.map((option) => (
                      <SelectItem key={option.value} value={option.value}>
                        {option.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Select
                  value={victim.status}
                  onValueChange={(status) => patchPerson.mutate({ victim, patch: { status } })}
                >
                  <SelectTrigger className="h-10 rounded-xl" aria-label="Status">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {VICTIM_STATUSES.map((option) => (
                      <SelectItem key={option.value} value={option.value}>
                        {option.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </li>
          ))}
        </ul>

        <div className="grid gap-2 sm:grid-cols-[1fr_auto_auto]">
          <div className="space-y-1">
            <Label htmlFor="victim-label" className="text-xs">
              Add a person
            </Label>
            <Input
              id="victim-label"
              className="h-11 rounded-xl"
              placeholder="Driver, adult male"
              value={newLabel}
              onChange={(event) => setNewLabel(event.target.value)}
              maxLength={80}
            />
          </div>
          <div className="space-y-1">
            <Label className="text-xs">Priority</Label>
            <Select value={newPriority} onValueChange={setNewPriority}>
              <SelectTrigger className="h-11 rounded-xl" aria-label="New person priority">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {VICTIM_PRIORITIES.map((option) => (
                  <SelectItem key={option.value} value={option.value}>
                    {option.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <Button
            className="h-11 self-end rounded-xl"
            onClick={() => addPerson.mutate()}
            disabled={addPerson.isPending || newLabel.trim().length === 0}
          >
            {addPerson.isPending ? (
              <Loader2 className="size-4 animate-spin" />
            ) : (
              <Plus className="size-4" aria-hidden="true" />
            )}
            Add
          </Button>
        </div>
      </div>
    </div>
  );
}

function Detail({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
        {label}
      </p>
      <p className="mt-0.5 text-sm font-medium text-foreground">{value}</p>
    </div>
  );
}

function labelise(value: string) {
  return value.replace(/_/g, " ").replace(/^./, (char) => char.toUpperCase());
}
