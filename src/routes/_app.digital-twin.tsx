import { useCallback, useEffect, useMemo, useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { Activity, Copy, HeartPulse, MapPin, Radar, ShieldCheck, Siren } from "lucide-react";
import { toast } from "sonner";
import { PageHeader } from "@/components/system/page-header";
import { EmptyState } from "@/components/system/empty-state";
import { PanelSkeleton } from "@/components/system/loading-skeletons";
import { StatusIndicator } from "@/components/system/status-indicator";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { MapPreview } from "@/components/resqora/map-preview";
import { EmergencyCoordination } from "@/components/resqora/emergency-coordination";
import { ImSafeButton } from "@/components/resqora/im-safe-button";
import { ActionPlanCard } from "@/components/core/action-plan-card";
import { useAuth } from "@/hooks/use-auth";
import { useLivePosition } from "@/hooks/use-live-position";
import { useNearbyServices } from "@/hooks/use-nearby-services";
import { activeEmergencyQuery, contactsQuery, emergencyEventsQuery, profileQuery } from "@/lib/api";
import { locationPingsQuery } from "@/lib/resqora-data";
import { guardianSessionQuery, guardianUrl, guardianOf } from "@/lib/guardian";
import { coordsOf, copyText, mapsLink } from "@/lib/alerts";
import { INCIDENT_PHASES, phaseLabel, phaseRank } from "@/lib/incident";
import { cachePlan, cachedPlan, emergencyReference, medicalContext, persistPlan } from "@/lib/core";
import { generateActionPlan, type CoordinatorPlan } from "@/lib/coordinator.functions";
import { NOT_PROVIDED } from "@/lib/resqr";

/** Live workspace refresh cadence — fast enough to feel real-time, light on quota. */
const REFRESH_MS = 8000;

export const Route = createFileRoute("/_app/digital-twin")({
  head: () => ({
    meta: [
      { title: "Emergency Digital Twin — RESQORA CORE" },
      {
        name: "description",
        content:
          "The live RESQORA emergency workspace: real-time GPS, AI action plan, medical profile, guardian status and a second-by-second response timeline.",
      },
      { property: "og:title", content: "Emergency Digital Twin — RESQORA" },
      {
        property: "og:description",
        content: "A live mirror of your emergency with AI coordination and guardian tracking.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: DigitalTwinPage,
});

function DigitalTwinPage() {
  const { user } = useAuth();
  const { position } = useLivePosition();
  const active = useQuery({ ...activeEmergencyQuery(user?.id), refetchInterval: REFRESH_MS });
  const emergency = active.data ?? null;
  const events = useQuery({
    ...emergencyEventsQuery(emergency?.id),
    refetchInterval: emergency ? REFRESH_MS : false,
  });
  const pings = useQuery({
    ...locationPingsQuery(emergency?.id),
    refetchInterval: emergency ? REFRESH_MS : false,
  });
  const profile = useQuery(profileQuery(user?.id));
  const contacts = useQuery(contactsQuery(user?.id));
  const session = useQuery(guardianSessionQuery(emergency?.id));
  const nearby = useNearbyServices(position, { sessionKey: emergency?.id ?? null });

  const [plan, setPlan] = useState<CoordinatorPlan | null>(null);
  const [planLoading, setPlanLoading] = useState(false);
  const [planError, setPlanError] = useState<string | null>(null);

  useEffect(() => {
    setPlan(cachedPlan(emergency?.id));
    setPlanError(null);
  }, [emergency?.id]);

  const coords = coordsOf(emergency);
  const latestPing = pings.data?.[0] ?? null;
  const guardianContact = guardianOf(contacts.data);

  const services = useMemo(
    () =>
      (["hospital", "ambulance", "police", "fire"] as const)
        .flatMap((category) => nearby.data[category].slice(0, 2))
        .map((place) => `${place.category}: ${place.name} (${place.distanceKm.toFixed(1)} km)`),
    [nearby.data],
  );

  const buildPlan = useCallback(async () => {
    if (!emergency) return;
    setPlanLoading(true);
    setPlanError(null);
    try {
      const result = await generateActionPlan({
        data: {
          type: emergency.type,
          severity: emergency.severity,
          notes: emergency.notes ?? undefined,
          address: emergency.address ?? undefined,
          medical: medicalContext(profile.data),
          services: services.slice(0, 10),
          aiFindings: emergency.ai_summary ?? undefined,
        },
      });
      setPlan(result);
      cachePlan(emergency.id, result);
      await persistPlan(emergency.id, result).catch(() => undefined);
    } catch (error) {
      setPlanError(error instanceof Error ? error.message : "Could not build the action plan.");
    } finally {
      setPlanLoading(false);
    }
  }, [emergency, profile.data, services]);

  // The coordinator runs itself once per emergency so the workspace is never empty.
  useEffect(() => {
    if (!emergency || plan || planLoading || planError) return;
    if (cachedPlan(emergency.id)) return;
    void buildPlan();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [emergency?.id, plan, planLoading, planError]);

  if (active.isLoading) {
    return (
      <>
        <PageHeader icon={Radar} title="Emergency Digital Twin" description="Loading workspace…" />
        <PanelSkeleton />
      </>
    );
  }

  if (!emergency) {
    return (
      <>
        <PageHeader
          icon={Radar}
          title="Emergency Digital Twin"
          description="A live mirror of your emergency — GPS, AI coordination, medical profile, guardian status and timeline."
        />
        <EmptyState
          icon={Siren}
          title="No active emergency"
          description="The Digital Twin opens automatically the moment you activate Emergency SOS. Everything shown here comes from your live emergency session."
          action={
            <Button asChild variant="emergency">
              <Link to="/emergency">Open Emergency SOS</Link>
            </Button>
          }
        />
      </>
    );
  }

  const stepIndex = phaseRank(emergency.phase);

  return (
    <>
      <PageHeader
        icon={Radar}
        title="Emergency Digital Twin"
        description={`Live workspace for emergency ${emergencyReference(emergency)} — refreshing every ${REFRESH_MS / 1000} seconds.`}
      />

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_360px]">
        <div className="grid gap-4">
          <section aria-label="Emergency overview" className="glass-panel rounded-3xl p-4 sm:p-5">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="min-w-0">
                <p className="text-[11px] uppercase tracking-[0.16em] text-muted-foreground">
                  Emergency ID
                </p>
                <p className="font-display text-2xl font-bold text-foreground">
                  {emergencyReference(emergency)}
                </p>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <StatusIndicator status="critical" label={phaseLabel(emergency.phase)} />
                <Badge
                  variant="outline"
                  className="rounded-full text-[10px] font-semibold uppercase"
                >
                  {emergency.type.replace(/_/g, " ")} · {emergency.severity}
                </Badge>
              </div>
            </div>

            <div className="mt-4 grid gap-2 sm:grid-cols-4">
              {INCIDENT_PHASES.slice(0, 8).map((step, index) => (
                <div
                  key={step.key}
                  className={`rounded-2xl border p-3 ${
                    index <= stepIndex
                      ? "border-alert/40 bg-alert/10"
                      : "border-border/60 bg-background/50"
                  }`}
                >
                  <p className="text-[10px] uppercase tracking-[0.12em] text-muted-foreground">
                    Step {index + 1}
                  </p>
                  <p className="text-xs font-semibold text-foreground">{step.label}</p>
                </div>
              ))}
            </div>

            <div className="mt-4 overflow-hidden rounded-2xl border border-border/60">
              <MapPreview coords={coords} className="h-56 sm:h-72" />
            </div>

            <dl className="mt-4 grid gap-3 sm:grid-cols-2">
              <div>
                <dt className="text-[11px] uppercase tracking-[0.12em] text-muted-foreground">
                  Address
                </dt>
                <dd className="text-sm text-foreground">{emergency.address ?? "Resolving…"}</dd>
              </div>
              <div>
                <dt className="text-[11px] uppercase tracking-[0.12em] text-muted-foreground">
                  Coordinates
                </dt>
                <dd className="flex items-center gap-2 text-sm text-foreground">
                  {coords
                    ? `${coords.lat.toFixed(6)}, ${coords.lng.toFixed(6)}`
                    : "Waiting for GPS fix"}
                  {coords && (
                    <Button
                      size="icon"
                      variant="ghost"
                      aria-label="Copy coordinates"
                      onClick={async () => {
                        await copyText(`${coords.lat}, ${coords.lng}`);
                        toast.success("Coordinates copied");
                      }}
                    >
                      <Copy className="size-3.5" aria-hidden="true" />
                    </Button>
                  )}
                </dd>
              </div>
              <div>
                <dt className="text-[11px] uppercase tracking-[0.12em] text-muted-foreground">
                  GPS accuracy
                </dt>
                <dd className="text-sm text-foreground">
                  {latestPing?.accuracy ? `±${Math.round(latestPing.accuracy)} m` : "—"}
                </dd>
              </div>
              <div>
                <dt className="text-[11px] uppercase tracking-[0.12em] text-muted-foreground">
                  Location updated
                </dt>
                <dd className="text-sm text-foreground">
                  {emergency.location_updated_at
                    ? new Date(emergency.location_updated_at).toLocaleTimeString()
                    : "—"}
                </dd>
              </div>
            </dl>

            <div className="mt-4 flex flex-wrap gap-2">
              {coords && (
                <Button asChild size="sm" variant="outline">
                  <a href={mapsLink(coords)} target="_blank" rel="noreferrer">
                    <MapPin className="size-4" aria-hidden="true" />
                    Open in Maps
                  </a>
                </Button>
              )}
              <Button asChild size="sm" variant="ghost">
                <Link to="/live">Live tracking page</Link>
              </Button>
              <ImSafeButton
                emergency={emergency}
                profile={profile.data}
                contacts={contacts.data ?? []}
              />
            </div>
          </section>

          <ActionPlanCard
            plan={plan}
            loading={planLoading}
            error={planError}
            onRegenerate={() => void buildPlan()}
          />

          <EmergencyCoordination
            type={emergency.type}
            severity={emergency.severity}
            position={position}
            status={phaseLabel(emergency.phase)}
            nearby={nearby}
          />
        </div>

        <div className="grid gap-4">
          <section aria-label="Medical profile" className="glass-panel rounded-3xl p-4">
            <h2 className="inline-flex items-center gap-2 text-sm font-semibold text-foreground">
              <HeartPulse className="size-4 text-alert" aria-hidden="true" />
              Medical profile
            </h2>
            <dl className="mt-3 grid gap-2 text-xs">
              {[
                ["Name", profile.data?.full_name],
                ["Blood group", profile.data?.blood_group],
                ["Allergies", profile.data?.allergies],
                ["Conditions", profile.data?.medical_conditions],
                ["Medications", profile.data?.medications],
                ["Preferred hospital", profile.data?.preferred_hospital],
              ].map(([label, value]) => (
                <div key={label as string} className="flex gap-2">
                  <dt className="w-32 shrink-0 uppercase tracking-[0.1em] text-muted-foreground">
                    {label}
                  </dt>
                  <dd className="min-w-0 flex-1 text-foreground">{value || NOT_PROVIDED}</dd>
                </div>
              ))}
            </dl>
          </section>

          <section aria-label="Guardian status" className="glass-panel rounded-3xl p-4">
            <h2 className="inline-flex items-center gap-2 text-sm font-semibold text-foreground">
              <ShieldCheck className="size-4 text-primary" aria-hidden="true" />
              Guardian status
            </h2>
            {guardianContact ? (
              <div className="mt-3 grid gap-2 text-xs">
                <p className="text-sm font-semibold text-foreground">{guardianContact.name}</p>
                <p className="text-muted-foreground">
                  {guardianContact.relationship} · {guardianContact.phone}
                </p>
                <Badge
                  variant="outline"
                  className={`w-fit rounded-full text-[10px] font-semibold uppercase ${
                    session.data
                      ? "border-success/40 bg-success/10 text-success"
                      : "border-warning/40 bg-warning/10 text-warning"
                  }`}
                >
                  {session.data ? "Guardian dashboard live" : "Session not created yet"}
                </Badge>
                {session.data && (
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={async () => {
                      await copyText(guardianUrl(session.data!));
                      toast.success("Guardian link copied");
                    }}
                  >
                    <Copy className="size-4" aria-hidden="true" />
                    Copy guardian link
                  </Button>
                )}
              </div>
            ) : (
              <p className="mt-3 text-xs text-muted-foreground">
                No guardian designated.{" "}
                <Link to="/contacts" className="text-primary underline">
                  Choose a guardian
                </Link>
                .
              </p>
            )}
          </section>

          <section aria-label="Response timeline" className="glass-panel rounded-3xl p-4">
            <h2 className="inline-flex items-center gap-2 text-sm font-semibold text-foreground">
              <Activity className="size-4 text-primary" aria-hidden="true" />
              Response timeline
            </h2>
            <ol className="mt-3 grid gap-3">
              {(events.data ?? []).map((event) => (
                <li key={event.id} className="border-l-2 border-primary/40 pl-3">
                  <p className="text-xs font-semibold text-foreground">{event.label}</p>
                  {event.detail && (
                    <p className="text-[11px] text-muted-foreground">{event.detail}</p>
                  )}
                  <p className="text-[10px] uppercase tracking-[0.1em] text-muted-foreground">
                    {new Date(event.created_at).toLocaleTimeString()}
                  </p>
                </li>
              ))}
              {(events.data ?? []).length === 0 && (
                <li className="text-xs text-muted-foreground">Timeline entries appear here.</li>
              )}
            </ol>
          </section>
        </div>
      </div>
    </>
  );
}
