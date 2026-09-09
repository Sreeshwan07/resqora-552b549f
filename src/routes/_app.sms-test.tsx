/**
 * SMS SOS end-to-end test plan — a working checklist, not a static document.
 *
 * Readiness is read from the server (booleans only, never secret values), and
 * the verification section lists the real SMS-raised incidents on this account
 * with their real timeline, refreshing live from the database.
 */
import { useMemo, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { CheckCircle2, ClipboardList, MessageSquare, XCircle } from "lucide-react";
import { PageHeader } from "@/components/system/page-header";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Progress } from "@/components/ui/progress";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useAuth } from "@/hooks/use-auth";
import { useRealtimeTables } from "@/hooks/use-realtime-tables";
import { SMS_SOS_CONFIGURED, SMS_SOS_NUMBER, locationSourceLabel } from "@/lib/sms-sos";
import { smsReadinessFn } from "@/lib/sms-test.functions";
import {
  SMS_TEST_ACCEPTANCE,
  SMS_TEST_FAILURE_CASES,
  SMS_TEST_STEPS,
  smsIncidentEventsQuery,
  smsIncidentsQuery,
} from "@/lib/sms-test";

const STORAGE_KEY = "resqora.sms-test.progress";

export const Route = createFileRoute("/_app/sms-test")({
  head: () => ({
    meta: [
      { title: "SMS SOS test plan — RESQORA" },
      {
        name: "description",
        content:
          "Step-by-step end-to-end test plan for RESQORA feature-phone SMS SOS: readiness checks, expected timeline entries, live checks and acceptance criteria.",
      },
      { property: "og:title", content: "RESQORA SMS SOS test plan" },
      {
        property: "og:description",
        content:
          "Run a real feature-phone emergency end to end and verify every stage against live data.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: SmsTestPage,
});

function readProgress(): Record<string, boolean> {
  if (typeof window === "undefined") return {};
  try {
    return JSON.parse(window.localStorage.getItem(STORAGE_KEY) ?? "{}") as Record<string, boolean>;
  } catch {
    return {};
  }
}

function SmsTestPage() {
  const { user } = useAuth();
  const readiness = useServerFn(smsReadinessFn);
  const config = useQuery({
    queryKey: ["sms-readiness", user?.id],
    enabled: Boolean(user?.id),
    queryFn: () => readiness(),
  });

  const incidents = useQuery(smsIncidentsQuery(user?.id));
  const [selected, setSelected] = useState<string | null>(null);
  const activeId = selected ?? incidents.data?.[0]?.id;
  const events = useQuery(smsIncidentEventsQuery(activeId));

  const [done, setDone] = useState<Record<string, boolean>>(() => readProgress());
  const toggle = (id: string) => {
    setDone((prev) => {
      const next = { ...prev, [id]: !prev[id] };
      try {
        window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
      } catch {
        /* progress ticks are a convenience only */
      }
      return next;
    });
  };

  // Anything the test creates shows up here without a refresh.
  useRealtimeTables({
    channel: user?.id ? `sms-test-${user.id}` : null,
    enabled: Boolean(user?.id),
    watch: [
      { table: "emergencies", filter: `user_id=eq.${user?.id ?? ""}` },
      { table: "emergency_events", filter: `user_id=eq.${user?.id ?? ""}` },
    ],
    invalidate: ["sms-incidents", "sms-incident-events"],
  });

  const checks = useMemo(
    () => [
      { label: "Inbound SMS number published to the app", ok: SMS_SOS_CONFIGURED },
      { label: "Webhook signing secret configured", ok: config.data?.webhookSecret ?? false },
      { label: "SMS provider connection configured", ok: config.data?.gatewayKey ?? false },
      { label: "Provider gateway access configured", ok: config.data?.providerKey ?? false },
      { label: "Landmark-to-map lookup configured", ok: config.data?.geocoding ?? false },
    ],
    [config.data],
  );

  const readyToRun = checks.every((c) => c.ok);
  const totalSteps = SMS_TEST_STEPS.length;
  const completed = SMS_TEST_STEPS.filter((s) => done[s.id]).length;

  return (
    <div className="space-y-6">
      <PageHeader
        icon={ClipboardList}
        title="SMS SOS test plan"
        description="Run one real emergency from a real feature phone, end to end, and check every stage against live data."
      />

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-sm">Before you start</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <ul className="space-y-2">
            {checks.map((check) => (
              <li key={check.label} className="flex items-center gap-2 text-sm">
                {check.ok ? (
                  <CheckCircle2 className="size-4 text-safe" aria-hidden="true" />
                ) : (
                  <XCircle className="size-4 text-alert" aria-hidden="true" />
                )}
                <span className={check.ok ? "text-foreground" : "text-muted-foreground"}>
                  {check.label}
                </span>
              </li>
            ))}
          </ul>
          {config.isError && (
            <p className="text-xs text-alert">
              Could not read the deployment settings just now — try again in a moment.
            </p>
          )}
          <p className="text-xs text-muted-foreground">
            {readyToRun
              ? `Everything needed is in place. Send test messages to ${SMS_SOS_NUMBER}.`
              : "The test can only be run once every item above is in place. Nothing is simulated in the meantime."}
          </p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between gap-3 pb-3">
          <CardTitle className="text-sm">
            Test run · {completed} of {totalSteps} steps ticked
          </CardTitle>
          {completed > 0 && (
            <Button
              size="sm"
              variant="outline"
              onClick={() => {
                setDone({});
                try {
                  window.localStorage.removeItem(STORAGE_KEY);
                } catch {
                  /* nothing to clear */
                }
              }}
            >
              Reset
            </Button>
          )}
        </CardHeader>
        <CardContent className="space-y-4">
          <Progress value={(completed / totalSteps) * 100} />
          <ol className="space-y-3">
            {SMS_TEST_STEPS.map((step) => (
              <li key={step.id} className="rounded-2xl border border-border p-4">
                <div className="flex items-start gap-3">
                  <Checkbox
                    id={`step-${step.id}`}
                    checked={Boolean(done[step.id])}
                    onCheckedChange={() => toggle(step.id)}
                    aria-label={`Mark ${step.title} as done`}
                    className="mt-0.5"
                  />
                  <div className="min-w-0 space-y-2">
                    <label
                      htmlFor={`step-${step.id}`}
                      className="text-sm font-semibold text-foreground"
                    >
                      {step.title}
                    </label>
                    <p className="text-sm text-muted-foreground">{step.action}</p>
                    {step.timeline.length > 0 && (
                      <Detail title="Timeline entries expected" items={step.timeline} />
                    )}
                    {step.realtime.length > 0 && (
                      <Detail title="Must update live, no refresh" items={step.realtime} />
                    )}
                    <Detail title="Check" items={step.verify} />
                  </div>
                </div>
              </li>
            ))}
          </ol>
        </CardContent>
      </Card>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm">Failure cases to prove</CardTitle>
          </CardHeader>
          <CardContent>
            <Detail title="Each must behave exactly as stated" items={SMS_TEST_FAILURE_CASES} />
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm">Acceptance criteria</CardTitle>
          </CardHeader>
          <CardContent>
            <Detail title="The test passes only when all are true" items={SMS_TEST_ACCEPTANCE} />
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-sm">
            <MessageSquare className="size-4 text-primary" aria-hidden="true" />
            Verify the run against live data
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {(incidents.data ?? []).length === 0 ? (
            <p className="text-sm text-muted-foreground">
              No emergency has arrived by SMS on this account yet. Once a test message is received it
              will appear here on its own.
            </p>
          ) : (
            <>
              <ul className="space-y-2">
                {(incidents.data ?? []).map((incident) => {
                  const isActive = incident.id === activeId;
                  return (
                    <li key={incident.id}>
                      <button
                        type="button"
                        onClick={() => setSelected(incident.id)}
                        className={`w-full rounded-2xl border p-3 text-left ${
                          isActive ? "border-primary bg-primary/5" : "border-border"
                        }`}
                      >
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="text-sm font-semibold text-foreground">
                            {incident.public_code ?? incident.id.slice(0, 8).toUpperCase()}
                          </span>
                          <Badge variant="outline">SMS</Badge>
                          <Badge variant="outline">{incident.phase}</Badge>
                          <Badge variant="outline">
                            {locationSourceLabel(incident.location_source)}
                          </Badge>
                        </div>
                        <p className="mt-1 text-xs text-muted-foreground">
                          {incident.type} · {incident.address ?? "no location recorded"} ·{" "}
                          {new Date(incident.started_at).toLocaleString()}
                        </p>
                      </button>
                    </li>
                  );
                })}
              </ul>

              <div className="rounded-2xl border border-border p-3">
                <p className="text-xs font-semibold text-foreground">Timeline</p>
                {(events.data ?? []).length === 0 ? (
                  <p className="mt-1 text-xs text-muted-foreground">No entries recorded yet.</p>
                ) : (
                  <ul className="mt-2 space-y-1.5">
                    {(events.data ?? []).map((event) => (
                      <li key={event.id} className="text-xs text-muted-foreground">
                        <span className="font-semibold text-foreground">{event.label}</span>
                        {event.detail ? ` — ${event.detail}` : ""} ·{" "}
                        {new Date(event.created_at).toLocaleTimeString()}
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function Detail({ title, items }: { title: string; items: readonly string[] }) {
  return (
    <div>
      <p className="text-xs font-semibold text-foreground">{title}</p>
      <ul className="mt-1 space-y-1">
        {items.map((item) => (
          <li key={item} className="text-xs text-muted-foreground">
            • {item}
          </li>
        ))}
      </ul>
    </div>
  );
}
