/**
 * Responder inbox — the working screen for an ambulance crew, rescue team or
 * volunteer responder: their availability, and the jobs assigned to them.
 *
 * Status changes go through the server function `update_assignment_status`, so
 * the assignment, the unit's status, the incident phase and the timeline all
 * move together and only the assigned responder (or an admin) can move them.
 */
import { useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { queryOptions, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Ambulance, BadgeCheck, Radio } from "lucide-react";
import { toast } from "sonner";
import { PageHeader } from "@/components/system/page-header";
import { EmptyState } from "@/components/system/empty-state";
import { PanelSkeleton } from "@/components/system/loading-skeletons";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { FieldError, PhoneInputField, TextInputField } from "@/components/system/validated-field";
import {
  fieldError,
  firstIssue,
  optionalMobileSchema,
  personNameSchema,
  responderProfileSchema,
  toPhoneDigits,
} from "@/lib/validation";

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
import {
  RESOURCE_TYPES,
  assignmentStatusLabel,
  myAssignmentsQuery,
  resourceTypeLabel,
  setAssignmentStatus,
  type AssignmentStatus,
} from "@/lib/dispatch";

const AVAILABILITY = [
  { value: "available", label: "Available" },
  { value: "busy", label: "On a job" },
  { value: "off_duty", label: "Off duty" },
] as const;

/** The next sensible step for a responder, in the order a real job happens. */
const NEXT_STEPS: Record<string, AssignmentStatus[]> = {
  assigned: ["accepted", "declined"],
  accepted: ["en_route"],
  en_route: ["on_scene"],
  on_scene: ["completed"],
};

type ResponderProfile = {
  id: string;
  user_id: string;
  full_name: string;
  responder_type: string;
  organisation: string | null;
  phone: string | null;
  availability: string;
  active: boolean;
};

const responderProfileQuery = (userId: string | undefined) =>
  queryOptions({
    queryKey: ["responder-profile", userId],
    enabled: Boolean(userId),
    queryFn: async (): Promise<ResponderProfile | null> => {
      const { data, error } = await supabase
        .from("responder_profiles")
        .select("id, user_id, full_name, responder_type, organisation, phone, availability, active")
        .eq("user_id", userId!)
        .maybeSingle();
      if (error) throw new Error(error.message);
      return (data ?? null) as ResponderProfile | null;
    },
  });

export const Route = createFileRoute("/_app/responder")({
  head: () => ({
    meta: [
      { title: "Responder inbox — RESQORA" },
      {
        name: "description",
        content:
          "Responder workspace in RESQORA: set your availability, accept assigned incidents and update progress from en route to on scene to completed.",
      },
      { property: "og:title", content: "RESQORA responder inbox" },
      {
        property: "og:description",
        content: "Accept incident assignments and report progress from the field.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: ResponderPage,
});

function ResponderPage() {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const profile = useQuery(responderProfileQuery(user?.id));
  const assignments = useQuery(myAssignmentsQuery(user?.id));

  const update = useMutation({
    mutationFn: ({ id, status }: { id: string; status: AssignmentStatus }) =>
      setAssignmentStatus(id, status),
    onSuccess: async (_result, variables) => {
      toast.success(`Marked ${assignmentStatusLabel(variables.status).toLowerCase()}`);
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["my-assignments"] }),
        queryClient.invalidateQueries({ queryKey: ["response-resources"] }),
        queryClient.invalidateQueries({ queryKey: ["command-incidents"] }),
      ]);
    },
    onError: (error: Error) => toast.error(error.message),
  });

  return (
    <div className="space-y-6">
      <PageHeader
        icon={Radio}
        title="Responder inbox"
        description="Your availability and the jobs sent to you, with one tap to accept and report progress."
      />

      <ResponderIdentity userId={user?.id} profile={profile.data ?? null} />

      <Card>
        <CardHeader>
          <CardTitle className="text-base">My assignments</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {assignments.isLoading ? (
            <PanelSkeleton />
          ) : (assignments.data ?? []).length === 0 ? (
            <EmptyState
              icon={Ambulance}
              title="Nothing assigned to you"
              description="When a coordinator sends your unit to an incident, the job appears here straight away."
            />
          ) : (
            (assignments.data ?? []).map((assignment) => {
              const steps = NEXT_STEPS[assignment.status] ?? [];
              return (
                <div key={assignment.id} className="rounded-xl border border-border p-4">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="min-w-0">
                      <p className="truncate text-sm font-semibold">{assignment.resource_name}</p>
                      <p className="text-xs text-muted-foreground">
                        {resourceTypeLabel(assignment.resource_type)}
                        {assignment.eta_minutes ? ` · ETA ${assignment.eta_minutes} min` : ""} ·
                        incident {assignment.emergency_id.slice(0, 8).toUpperCase()}
                      </p>
                    </div>
                    <Badge variant="outline">{assignmentStatusLabel(assignment.status)}</Badge>
                  </div>
                  {assignment.notes && (
                    <p className="mt-2 text-sm text-muted-foreground">{assignment.notes}</p>
                  )}
                  {steps.length > 0 && (
                    <div className="mt-3 flex flex-wrap gap-2">
                      {steps.map((step) => (
                        <Button
                          key={step}
                          size="sm"
                          variant={step === "declined" ? "outline" : "default"}
                          disabled={update.isPending}
                          onClick={() => update.mutate({ id: assignment.id, status: step })}
                        >
                          {assignmentStatusLabel(step)}
                        </Button>
                      ))}
                    </div>
                  )}
                </div>
              );
            })
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function ResponderIdentity({
  userId,
  profile,
}: {
  userId: string | undefined;
  profile: ResponderProfile | null;
}) {
  const queryClient = useQueryClient();
  const [name, setName] = useState(profile?.full_name ?? "");
  const [type, setType] = useState(profile?.responder_type ?? "ambulance");
  const [organisation, setOrganisation] = useState(profile?.organisation ?? "");
  const [phone, setPhone] = useState(toPhoneDigits(profile?.phone ?? ""));
  const [touched, setTouched] = useState<{ name?: boolean; phone?: boolean }>({});
  const [saveError, setSaveError] = useState<string | null>(null);

  const nameError = fieldError(personNameSchema, name, { touched: touched.name });
  const phoneError = fieldError(optionalMobileSchema, phone, { touched: touched.phone });

  const save = useMutation({
    mutationFn: async () => {
      if (!userId) throw new Error("Sign in first.");
      setTouched({ name: true, phone: true });
      const parsed = responderProfileSchema.safeParse({ full_name: name, phone });
      if (!parsed.success) {
        const message = firstIssue(parsed.error);
        setSaveError(message);
        throw new Error(message);
      }
      setSaveError(null);
      const payload = {
        user_id: userId,
        full_name: parsed.data.full_name,
        responder_type: type,
        organisation: organisation.trim() || null,
        phone: parsed.data.phone || null,
        active: true,
      };
      const { error } = profile
        ? await supabase.from("responder_profiles").update(payload).eq("id", profile.id)
        : await supabase.from("responder_profiles").insert(payload);
      if (error) throw new Error(error.message);
    },
    onSuccess: async () => {
      toast.success("Responder details saved");
      await queryClient.invalidateQueries({ queryKey: ["responder-profile"] });
    },
    onError: (error: Error) => toast.error(error.message),
  });

  const setAvailability = useMutation({
    mutationFn: async (availability: string) => {
      if (!profile) throw new Error("Save your responder details first.");
      const { error } = await supabase
        .from("responder_profiles")
        .update({ availability })
        .eq("id", profile.id);
      if (error) throw new Error(error.message);
    },
    onSuccess: async () => {
      toast.success("Availability updated");
      await queryClient.invalidateQueries({ queryKey: ["responder-profile"] });
    },
    onError: (error: Error) => toast.error(error.message),
  });

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <BadgeCheck className="size-4 text-primary" aria-hidden="true" />
          My responder details
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <TextInputField
            id="responder-name"
            label="Name"
            required
            placeholder="Crew or team name"
            value={name}
            error={nameError}
            onBlur={() => setTouched((prev) => ({ ...prev, name: true }))}
            onChange={setName}
          />
          <div className="space-y-1.5">
            <Label htmlFor="responder-type">Type</Label>
            <Select value={type} onValueChange={setType}>
              <SelectTrigger id="responder-type">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {RESOURCE_TYPES.map((entry) => (
                  <SelectItem key={entry.value} value={entry.value}>
                    {entry.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <TextInputField
            id="responder-org"
            label="Organisation"
            placeholder="Service or NGO"
            value={organisation}
            onChange={setOrganisation}
          />
          <PhoneInputField
            id="responder-phone"
            label="Phone"
            hint="Optional 10-digit mobile number"
            value={phone}
            error={phoneError}
            onBlur={() => setTouched((prev) => ({ ...prev, phone: true }))}
            onChange={setPhone}
          />
        </div>

        <FieldError message={saveError} />

        <div className="flex flex-wrap items-center gap-3">
          <Button onClick={() => save.mutate()} disabled={save.isPending}>
            {profile ? "Save details" : "Register as responder"}
          </Button>
          {profile && (
            <div className="flex items-center gap-2">
              <span className="text-sm text-muted-foreground">Availability</span>
              <Select
                value={profile.availability}
                onValueChange={(value) => setAvailability.mutate(value)}
              >
                <SelectTrigger className="w-[160px]">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {AVAILABILITY.map((entry) => (
                    <SelectItem key={entry.value} value={entry.value}>
                      {entry.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
