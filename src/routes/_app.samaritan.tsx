import { useEffect, useMemo, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  BadgeCheck,
  HandHeart,
  Loader2,
  MapPin,
  Navigation,
  ShieldAlert,
  Users,
} from "lucide-react";
import { toast } from "sonner";
import { PageHeader } from "@/components/system/page-header";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { Slider } from "@/components/ui/slider";
import { useAuth } from "@/hooks/use-auth";
import { useLivePosition } from "@/hooks/use-live-position";
import { useRealtimeTables } from "@/hooks/use-realtime-tables";
import { useVolunteerTracking } from "@/hooks/use-volunteer-tracking";
import {
  SAFETY_NOTICE,
  VERIFICATION_LABELS,
  VOLUNTEER_SKILLS,
  acceptedIncidentsQuery,
  completeAssistance,
  minutesAgo,
  myVolunteerQuery,
  navigationLink,
  respondToRequest,
  saveVolunteerProfile,
  setVolunteerAvailability,
  skillLabels,
  updateVolunteerPosition,
  volunteerRequestsQuery,
} from "@/lib/volunteers";
import { locationSourceLabel } from "@/lib/sms-sos";

export const Route = createFileRoute("/_app/samaritan")({
  head: () => ({
    meta: [
      { title: "Good Samaritan Network — RESQORA" },
      {
        name: "description",
        content:
          "Join the RESQORA Good Samaritan network: verified nearby volunteers can be asked to help during a live emergency, with full privacy controls.",
      },
      { property: "og:title", content: "RESQORA Good Samaritan Network" },
      {
        property: "og:description",
        content: "Verified nearby volunteers, matched only to live emergencies they accept.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: SamaritanPage,
});

function SamaritanPage() {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const { position } = useLivePosition();
  const profile = useQuery(myVolunteerQuery(user?.id));
  const volunteer = profile.data;
  const verified = volunteer?.verification_status === "verified";
  const requests = useQuery(volunteerRequestsQuery(Boolean(verified)));
  const accepted = useQuery(acceptedIncidentsQuery(Boolean(verified)));

  const [form, setForm] = useState({
    fullName: "",
    phone: "",
    skills: [] as string[],
    experience: "",
    radiusKm: 5,
    shareLocation: true,
  });
  const [seeded, setSeeded] = useState(false);
  const [touched, setTouched] = useState<{ fullName?: boolean; phone?: boolean }>({});
  const [saveError, setSaveError] = useState<string | null>(null);

  const nameError = fieldError(personNameSchema, form.fullName, { touched: touched.fullName });
  const phoneError = fieldError(mobileSchema, form.phone, { touched: touched.phone });

  useEffect(() => {
    if (seeded || !volunteer) return;
    setForm({
      fullName: volunteer.full_name,
      phone: toPhoneDigits(volunteer.phone),
      skills: volunteer.skills ?? [],
      experience: volunteer.experience ?? "",
      radiusKm: volunteer.radius_km,
      shareLocation: volunteer.share_location,
    });
    setSeeded(true);
  }, [volunteer, seeded]);


  // Live offers/claims straight from the database — no manual refresh.
  useRealtimeTables({
    channel: user?.id ? `volunteer-matches-${user.id}` : null,
    enabled: Boolean(verified && user?.id),
    watch: [
      { table: "volunteer_incident_matches", filter: `volunteer_user_id=eq.${user?.id ?? ""}` },
    ],
    invalidate: ["volunteer-requests", "volunteer-accepted"],
    onChange: ({ eventType, row }) => {
      const status = (row as { status?: string } | null)?.status;
      if (eventType === "INSERT" && status === "offered") {
        toast.warning("Emergency nearby — a new assistance request just arrived.");
      }
    },
  });

  // Real location tracking, only while on duty and opted in.
  const tracking = useVolunteerTracking({
    profileId: volunteer?.id,
    enabled: Boolean(verified && volunteer?.availability === "available" && volunteer?.share_location),
    onWritten: () => void queryClient.invalidateQueries({ queryKey: ["volunteer-profile"] }),
  });

  const save = useMutation({
    mutationFn: async () => {
      if (!user?.id) throw new Error("Sign in first.");
      setTouched({ fullName: true, phone: true });
      const parsed = volunteerSignupSchema.safeParse({
        full_name: form.fullName,
        phone: form.phone,
        skills: form.skills,
        experience: form.experience,
        radius_km: form.radiusKm,
      });
      if (!parsed.success) {
        const message = firstIssue(parsed.error);
        setSaveError(message);
        throw new Error(message);
      }
      setSaveError(null);
      return saveVolunteerProfile(user.id, {
        ...form,
        fullName: parsed.data.full_name,
        phone: parsed.data.phone,
        availability: volunteer?.availability === "offline" ? "offline" : "available",
        latitude: position?.lat ?? null,
        longitude: position?.lng ?? null,
      });
    },
    onSuccess: () => {
      toast.success(
        volunteer
          ? "Volunteer details updated."
          : "Thanks for signing up — an administrator will review your details.",
      );
      void queryClient.invalidateQueries({ queryKey: ["volunteer-profile"] });
    },
    onError: (error: Error) => toast.error(error.message),
  });


  const toggleAvailability = useMutation({
    mutationFn: async (next: boolean) => {
      if (!volunteer) return;
      await setVolunteerAvailability(volunteer.id, next ? "available" : "offline");
    },
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ["volunteer-profile"] }),
    onError: (error: Error) => toast.error(error.message),
  });

  const refreshLocation = useMutation({
    mutationFn: async () => {
      if (!volunteer) throw new Error("Sign up first.");
      if (!position) throw new Error("Location is not available yet.");
      await updateVolunteerPosition(volunteer.id, position);
    },
    onSuccess: () => {
      toast.success("Location updated.");
      void queryClient.invalidateQueries({ queryKey: ["volunteer-profile"] });
    },
    onError: (error: Error) => toast.error(error.message),
  });

  const respond = useMutation({
    mutationFn: async ({ matchId, accept }: { matchId: string; accept: boolean }) =>
      respondToRequest(matchId, accept),
    onSuccess: (result, variables) => {
      if (!variables.accept) toast.success("Declined.");
      else if (result.claimed) toast.success("You accepted — exact location is now shown.");
      else toast.info("Another volunteer already accepted this request.");
      void queryClient.invalidateQueries({ queryKey: ["volunteer-requests"] });
      void queryClient.invalidateQueries({ queryKey: ["volunteer-accepted"] });
    },
    onError: (error: Error) => toast.error(error.message),
  });

  const complete = useMutation({
    mutationFn: async (matchId: string) => completeAssistance(matchId),
    onSuccess: () => {
      toast.success("Marked as helped.");
      void queryClient.invalidateQueries({ queryKey: ["volunteer-accepted"] });
    },
    onError: (error: Error) => toast.error(error.message),
  });

  const staleLocation = useMemo(() => {
    // Matching ignores positions older than 30 minutes.
    const mins = minutesAgo(volunteer?.location_updated_at);
    return mins == null || mins > 30;
  }, [volunteer?.location_updated_at]);

  function toggleSkill(value: string) {
    setForm((f) => ({
      ...f,
      skills: f.skills.includes(value) ? f.skills.filter((s) => s !== value) : [...f.skills, value],
    }));
  }

  return (
    <div className="space-y-6">
      <PageHeader
        icon={HandHeart}
        title="Good Samaritan network"
        description="Opt in to be asked for help when a verified emergency happens close to you."
      />

      <div className="glass-panel flex items-start gap-3 rounded-2xl border border-alert/40 p-4">
        <ShieldAlert className="mt-0.5 size-5 shrink-0 text-alert" aria-hidden="true" />
        <p className="text-sm text-muted-foreground">{SAFETY_NOTICE}</p>
      </div>

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)]">
        <section className="glass-panel space-y-4 rounded-2xl p-5">
          <div className="flex items-center justify-between gap-3">
            <h2 className="text-sm font-semibold text-foreground">
              {volunteer ? "Your volunteer details" : "Sign up as a volunteer"}
            </h2>
            {volunteer && (
              <Badge variant={verified ? "default" : "secondary"} className="gap-1">
                <BadgeCheck className="size-3.5" aria-hidden="true" />
                {VERIFICATION_LABELS[volunteer.verification_status]}
              </Badge>
            )}
          </div>

          {volunteer && !verified && (
            <p className="rounded-xl bg-muted/50 p-3 text-xs text-muted-foreground">
              You will only start receiving requests once an administrator verifies you. Nothing is
              shared with anyone before then.
            </p>
          )}

          <div className="grid gap-3 sm:grid-cols-2">
            <TextInputField
              id="v-name"
              label="Full name"
              required
              placeholder="Your name"
              value={form.fullName}
              error={nameError}
              onBlur={() => setTouched((prev) => ({ ...prev, fullName: true }))}
              onChange={(v) => setForm((f) => ({ ...f, fullName: v }))}
            />
            <PhoneInputField
              id="v-phone"
              label="Phone number"
              required
              hint="10-digit Indian mobile number"
              value={form.phone}
              error={phoneError}
              onBlur={() => setTouched((prev) => ({ ...prev, phone: true }))}
              onChange={(v) => setForm((f) => ({ ...f, phone: v }))}
            />
          </div>


          <div className="space-y-2">
            <Label>Skills you can offer</Label>
            <div className="flex flex-wrap gap-2">
              {VOLUNTEER_SKILLS.map((skill) => {
                const on = form.skills.includes(skill.value);
                return (
                  <button
                    key={skill.value}
                    type="button"
                    aria-pressed={on}
                    onClick={() => toggleSkill(skill.value)}
                    className={`rounded-full border px-3 py-1.5 text-xs font-medium transition-colors ${
                      on
                        ? "border-primary bg-primary text-primary-foreground"
                        : "border-border text-muted-foreground hover:bg-muted/60"
                    }`}
                  >
                    {skill.label}
                  </button>
                );
              })}
            </div>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="v-exp">Experience or certification (optional)</Label>
            <Textarea
              id="v-exp"
              rows={3}
              value={form.experience}
              onChange={(e) => setForm((f) => ({ ...f, experience: e.target.value }))}
              placeholder="e.g. Registered nurse, 4 years in emergency care"
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="v-radius">How far you are willing to travel: {form.radiusKm} km</Label>
            <Slider
              id="v-radius"
              min={1}
              max={25}
              step={1}
              value={[form.radiusKm]}
              onValueChange={([v]) => setForm((f) => ({ ...f, radiusKm: v ?? 5 }))}
            />
          </div>

          <div className="flex items-center justify-between gap-3 rounded-xl border border-border p-3">
            <div className="min-w-0">
              <p className="text-sm font-medium text-foreground">Share my location for matching</p>
              <p className="text-xs text-muted-foreground">
                Your position is only used to measure distance. It is never shown to other users.
              </p>
            </div>
            <Switch
              checked={form.shareLocation}
              onCheckedChange={(v) => setForm((f) => ({ ...f, shareLocation: v }))}
              aria-label="Share my location for matching"
            />
          </div>

          <Button onClick={() => save.mutate()} disabled={save.isPending} className="w-full">
            {save.isPending && <Loader2 className="mr-2 size-4 animate-spin" aria-hidden="true" />}
            {volunteer ? "Save details" : "Join the network"}
          </Button>

          {volunteer && (
            <div className="space-y-3 rounded-xl border border-border p-3">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <p className="text-sm font-medium text-foreground">Available right now</p>
                  <p className="text-xs text-muted-foreground">
                    Turn off any time — you stop receiving requests immediately.
                  </p>
                </div>
                <Switch
                  checked={volunteer.availability === "available"}
                  onCheckedChange={(v) => toggleAvailability.mutate(v)}
                  aria-label="Available right now"
                />
              </div>
              <div className="flex items-center justify-between gap-3">
                <p className="text-xs text-muted-foreground">
                  {volunteer.location_updated_at
                    ? `Location updated ${minutesAgo(volunteer.location_updated_at)} min ago`
                    : "No location shared yet"}
                  {staleLocation && " — refresh it to be matched."}
                  {volunteer.availability === "available" &&
                    volunteer.share_location &&
                    !tracking.error &&
                    " Kept up to date automatically while you are available."}
                  {tracking.error ? ` ${tracking.error}` : ""}
                </p>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => refreshLocation.mutate()}
                  disabled={refreshLocation.isPending}
                >
                  <MapPin className="mr-1.5 size-3.5" aria-hidden="true" />
                  Update
                </Button>
              </div>
            </div>
          )}
        </section>

        <div className="space-y-6">
          <section className="glass-panel space-y-3 rounded-2xl p-5">
            <h2 className="flex items-center gap-2 text-sm font-semibold text-foreground">
              <Users className="size-4 text-primary" aria-hidden="true" />
              Assistance requests
            </h2>
            {!verified ? (
              <p className="text-sm text-muted-foreground">
                Requests appear here once you are verified.
              </p>
            ) : requests.isLoading ? (
              <p className="text-sm text-muted-foreground">Checking for requests…</p>
            ) : (requests.data ?? []).length === 0 ? (
              <p className="text-sm text-muted-foreground">No open requests near you right now.</p>
            ) : (
              <ul className="space-y-3">
                {requests.data!.map((request) => (
                  <li key={request.match_id} className="rounded-xl border border-border p-3">
                    <p className="text-sm font-semibold text-foreground">
                      {request.emergency_type ?? "Emergency"} ·{" "}
                      {request.distance_km != null ? `${request.distance_km} km away` : "Nearby"}
                    </p>
                    <p className="mt-1 text-xs text-muted-foreground">
                      Area: {request.approx_area}. Exact location and contact details are only
                      shared if you accept.
                    </p>
                    {request.assistance_required.length > 0 && (
                      <p className="mt-1 text-xs text-muted-foreground">
                        Needed: {skillLabels(request.assistance_required).join(", ")}
                      </p>
                    )}
                    <div className="mt-3 flex gap-2">
                      <Button
                        size="sm"
                        onClick={() => respond.mutate({ matchId: request.match_id, accept: true })}
                        disabled={respond.isPending}
                      >
                        Accept
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => respond.mutate({ matchId: request.match_id, accept: false })}
                        disabled={respond.isPending}
                      >
                        Decline
                      </Button>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section className="glass-panel space-y-3 rounded-2xl p-5">
            <h2 className="text-sm font-semibold text-foreground">Incidents you accepted</h2>
            {!verified ? (
              <p className="text-sm text-muted-foreground">Nothing yet.</p>
            ) : (accepted.data ?? []).length === 0 ? (
              <p className="text-sm text-muted-foreground">
                You have no accepted incidents right now.
              </p>
            ) : (
              <ul className="space-y-3">
                {accepted.data!.map((incident) => {
                  const link = navigationLink(incident.latitude, incident.longitude);
                  return (
                    <li key={incident.match_id} className="rounded-xl border border-border p-3">
                      <p className="text-sm font-semibold text-foreground">
                        {incident.victim_name} · {incident.reference}
                      </p>
                      <p className="mt-1 text-xs text-muted-foreground">
                        {incident.emergency_type ?? "Emergency"} · stage {incident.phase} ·{" "}
                        {incident.severity} severity
                      </p>
                      <p className="mt-1 text-xs text-muted-foreground">
                        {incident.address ?? "Address not recorded"} (
                        {locationSourceLabel(incident.location_source)})
                      </p>
                      {incident.notes && (
                        <p className="mt-1 text-xs text-muted-foreground">{incident.notes}</p>
                      )}
                      <div className="mt-3 flex flex-wrap gap-2">
                        {link && (
                          <Button size="sm" variant="outline" asChild>
                            <a href={link} target="_blank" rel="noreferrer">
                              <Navigation className="mr-1.5 size-3.5" aria-hidden="true" />
                              Navigate
                            </a>
                          </Button>
                        )}
                        <Button
                          size="sm"
                          onClick={() => complete.mutate(incident.match_id)}
                          disabled={complete.isPending || incident.status === "completed"}
                        >
                          {incident.status === "completed" ? "Helped" : "I have helped"}
                        </Button>
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}
          </section>
        </div>
      </div>
    </div>
  );
}
