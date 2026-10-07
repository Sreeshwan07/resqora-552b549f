/**
 * Representative performance tests for the RESQORA emergency workflow.
 *
 * Every number is measured live against the real backend from this browser.
 * Test emergencies are flagged `is_simulation = true` (so no volunteer matching
 * and no alerts to real contacts) and are cancelled through the same
 * server-checked status step the app uses. Nothing here is estimated.
 */
import { createClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";
import { supabase } from "@/integrations/supabase/client";

export type Sample = { ms: number; ok: boolean; note?: string };
export type ScenarioResult = {
  id: string;
  title: string;
  metric: string;
  unit: "ms";
  requests: number;
  samples: Sample[];
  /** Pass/fail on the correctness check of the scenario (e.g. exactly one winner). */
  check: { label: string; passed: boolean; detail: string };
};
export type PerfRun = {
  id?: string;
  started_at: string;
  finished_at?: string;
  environment: Record<string, string | number>;
  results: ScenarioResult[];
};

export function stats(samples: Sample[]) {
  const ms = samples.map((s) => s.ms);
  if (ms.length === 0) return { avg: 0, min: 0, max: 0, p95: 0, ok: 0, failed: 0 };
  const sorted = [...ms].sort((a, b) => a - b);
  return {
    avg: Math.round(ms.reduce((a, b) => a + b, 0) / ms.length),
    min: Math.round(sorted[0]!),
    max: Math.round(sorted[sorted.length - 1]!),
    p95: Math.round(sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * 0.95))]!),
    ok: samples.filter((s) => s.ok).length,
    failed: samples.filter((s) => !s.ok).length,
  };
}

async function timed<T>(fn: () => PromiseLike<T>): Promise<{ ms: number; value: T }> {
  const t = performance.now();
  const value = await fn();
  return { ms: performance.now() - t, value };
}

type Client = ReturnType<typeof createClient<Database>>;

/** Independent client (own connection) acting as the same signed-in user. */
function makeClient(token: string, fetchImpl?: typeof fetch): Client {
  return createClient<Database>(
    import.meta.env.VITE_SUPABASE_URL,
    import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY,
    {
      auth: { persistSession: false, autoRefreshToken: false, storage: undefined },
      global: { headers: { Authorization: `Bearer ${token}` }, fetch: fetchImpl },
    },
  );
}

function key() {
  return `perf:${crypto.randomUUID()}`;
}

async function createSim(c: Client, userId: string, idem: string, withLocation = false) {
  return c
    .from("emergencies")
    .insert({
      user_id: userId,
      type: "sos",
      severity: "high",
      status: "active",
      is_simulation: true,
      idempotency_key: idem,
      notes: "Performance test (simulation — no alerts sent)",
      ...(withLocation
        ? {
            latitude: 17.385,
            longitude: 78.4867,
            location_accuracy: 15,
            location_source: "test_fixture",
            location_updated_at: new Date().toISOString(),
          }
        : {}),
    })
    .select("id")
    .single();
}

async function cancelSim(c: Client, id: string) {
  return c.rpc("transition_emergency", {
    _emergency_id: id,
    _to_phase: "cancelled",
    _note: "Performance test cleanup",
    _request_id: `perf-cancel:${id}`,
  });
}

export async function runPerformanceSuite(onProgress: (label: string) => void): Promise<PerfRun> {
  const { data: sess } = await supabase.auth.getSession();
  const token = sess.session?.access_token;
  const userId = sess.session?.user.id;
  if (!token || !userId) throw new Error("Sign in to run the performance tests.");

  const base = makeClient(token);
  const live = await base
    .from("emergencies")
    .select("id")
    .eq("user_id", userId)
    .not("status", "in", "(resolved,cancelled)")
    .limit(1);
  if ((live.data ?? []).length > 0)
    throw new Error("You have an active emergency. Close it before running tests.");

  const started_at = new Date().toISOString();
  const nav = navigator as Navigator & { connection?: { effectiveType?: string; rtt?: number } };
  const environment = {
    location: "Browser → RESQORA backend (Lovable Cloud)",
    origin: window.location.origin,
    user_agent: navigator.userAgent.slice(0, 160),
    network_type: nav.connection?.effectiveType ?? "unknown",
    reported_rtt_ms: nav.connection?.rtt ?? "unknown",
    cpu_threads: navigator.hardwareConcurrency ?? "unknown",
    test_users: 1,
  };
  const results: ScenarioResult[] = [];

  // Baseline DB response time.
  onProgress("Database response time");
  {
    const samples: Sample[] = [];
    for (let i = 0; i < 10; i++) {
      const r = await timed(() => base.from("perf_test_runs").select("id").limit(1));
      samples.push({ ms: r.ms, ok: !r.value.error });
    }
    results.push({
      id: "db",
      title: "Database response time",
      metric: "Round-trip of a simple indexed read",
      unit: "ms",
      requests: samples.length,
      samples,
      check: {
        label: "All reads succeeded",
        passed: samples.every((s) => s.ok),
        detail: `${samples.filter((s) => s.ok).length}/${samples.length} ok`,
      },
    });
  }

  // Scenario 1: single-user SOS (create session + close).
  onProgress("Scenario 1 — single-user SOS");
  {
    const samples: Sample[] = [];
    for (let i = 0; i < 5; i++) {
      const r = await timed(() => createSim(base, userId, key()));
      samples.push({ ms: r.ms, ok: !r.value.error, note: r.value.error?.message });
      if (r.value.data) await cancelSim(base, r.value.data.id);
    }
    results.push({
      id: "s1",
      title: "Scenario 1 — single-user SOS activation",
      metric: "Emergency Session creation latency",
      unit: "ms",
      requests: samples.length,
      samples,
      check: {
        label: "Every SOS created one session",
        passed: samples.every((s) => s.ok),
        detail: `${samples.filter((s) => s.ok).length}/${samples.length} created`,
      },
    });
  }

  // Scenario 2: SOS with location capture + location pings.
  onProgress("Scenario 2 — SOS with location");
  {
    const samples: Sample[] = [];
    const created = await timed(() => createSim(base, userId, key(), true));
    samples.push({ ms: created.ms, ok: !created.value.error, note: "session + location" });
    const id = created.value.data?.id;
    if (id) {
      for (let i = 0; i < 5; i++) {
        const r = await timed(() =>
          base.from("location_pings").insert({
            emergency_id: id,
            user_id: userId,
            latitude: 17.385 + i * 0.0001,
            longitude: 78.4867,
            accuracy: 15,
          }),
        );
        samples.push({ ms: r.ms, ok: !r.value.error, note: "location ping" });
      }
      await cancelSim(base, id);
    }
    results.push({
      id: "s2",
      title: "Scenario 2 — SOS with location capture",
      metric: "Location processing latency (session with GPS, then 5 pings)",
      unit: "ms",
      requests: samples.length,
      samples,
      check: {
        label: "Session and all pings stored",
        passed: samples.every((s) => s.ok),
        detail: `${samples.filter((s) => s.ok).length}/${samples.length} ok`,
      },
    });
  }

  // Scenario 3: slow / unreliable network — added delay, first attempt lost, retry.
  onProgress("Scenario 3 — unreliable network");
  {
    const samples: Sample[] = [];
    let attempt = 0;
    const flaky: typeof fetch = async (input, init) => {
      await new Promise((r) => setTimeout(r, 800)); // injected latency
      const res = await fetch(input, init);
      attempt += 1;
      // The first write reaches the server but the reply is "lost".
      if (attempt === 1 && init?.method === "POST") throw new TypeError("Injected network drop");
      return res;
    };
    const c = makeClient(token, flaky);
    const idem = key();
    let id: string | undefined;
    const t = performance.now();
    for (let i = 0; i < 3 && !id; i++) {
      try {
        const r = await createSim(c, userId, idem);
        if (r.data) id = r.data.id;
        else if (r.error?.code === "23505") {
          // Duplicate blocked: the earlier attempt already created it — fetch it.
          const existing = await c
            .from("emergencies")
            .select("id")
            .eq("idempotency_key", idem)
            .single();
          id = existing.data?.id;
        }
        samples.push({ ms: performance.now() - t, ok: Boolean(id), note: `attempt ${i + 1}` });
      } catch (e) {
        samples.push({
          ms: performance.now() - t,
          ok: false,
          note: `attempt ${i + 1}: ${e instanceof Error ? e.message : "error"}`,
        });
      }
    }
    const count = await base
      .from("emergencies")
      .select("id", { count: "exact", head: true })
      .eq("idempotency_key", idem);
    if (id) await cancelSim(base, id);
    results.push({
      id: "s3",
      title: "Scenario 3 — SOS under unreliable network",
      metric: "Time to confirmed session with +800 ms latency and one dropped reply",
      unit: "ms",
      requests: samples.length,
      samples,
      check: {
        label: "Retry did not create a duplicate",
        passed: Boolean(id) && count.count === 1,
        detail: `${count.count ?? 0} session(s) stored for one SOS after ${samples.length} attempt(s)`,
      },
    });
  }

  // Shared emergency for scenarios 4 and 5.
  const shared = await createSim(base, userId, key(), true);
  const sharedId = shared.data?.id;

  // Scenario 4: many clients reading the same emergency simultaneously.
  onProgress("Scenario 4 — many viewers, same emergency");
  {
    const samples: Sample[] = [];
    const statuses = new Set<string>();
    if (sharedId) {
      const clients = Array.from({ length: 10 }, () => makeClient(token));
      await Promise.all(
        clients.map(async (c) => {
          const r = await timed(() =>
            c.from("emergencies").select("status, phase").eq("id", sharedId).single(),
          );
          if (r.value.data) statuses.add(`${r.value.data.status}/${r.value.data.phase}`);
          samples.push({ ms: r.ms, ok: !r.value.error });
        }),
      );
    }
    results.push({
      id: "s4",
      title: "Scenario 4 — multiple clients on the same emergency",
      metric: "Concurrent read latency (10 independent connections)",
      unit: "ms",
      requests: samples.length,
      samples,
      check: {
        label: "All viewers saw the same state",
        passed: samples.length > 0 && samples.every((s) => s.ok) && statuses.size === 1,
        detail: `${statuses.size} distinct state(s): ${[...statuses].join(", ") || "none"}`,
      },
    });
  }

  // Scenario 5: simultaneous conflicting status updates — exactly one wins.
  onProgress("Scenario 5 — simultaneous interactions");
  {
    const samples: Sample[] = [];
    let winners = 0;
    if (sharedId) {
      const clients = Array.from({ length: 10 }, () => makeClient(token));
      await Promise.all(
        clients.map(async (c, i) => {
          const r = await timed(() =>
            c.rpc("transition_emergency", {
              _emergency_id: sharedId,
              _to_phase: "dispatched",
              _note: "Performance test concurrent update",
              _request_id: `perf-race:${sharedId}:${i}`,
            }),
          );
          const changed = (r.value.data as { changed?: boolean } | null)?.changed === true;
          if (changed) winners += 1;
          samples.push({ ms: r.ms, ok: !r.value.error, note: changed ? "applied" : "no-op" });
        }),
      );
      await cancelSim(base, sharedId);
    }
    results.push({
      id: "s5",
      title: "Scenario 5 — multiple actors updating the same emergency",
      metric: "Concurrent status-change latency (10 simultaneous requests)",
      unit: "ms",
      requests: samples.length,
      samples,
      check: {
        label: "Exactly one update applied",
        passed: winners === 1,
        detail: `${winners} applied, ${samples.length - winners} safely rejected`,
      },
    });
  }

  // Scenario 6: concurrent session creation — one live emergency per user.
  onProgress("Scenario 6 — concurrent session creation");
  {
    const samples: Sample[] = [];
    const ids: string[] = [];
    const clients = Array.from({ length: 5 }, () => makeClient(token));
    await Promise.all(
      clients.map(async (c) => {
        const r = await timed(() => createSim(c, userId, key()));
        if (r.value.data) ids.push(r.value.data.id);
        samples.push({
          ms: r.ms,
          ok: !r.value.error,
          note: r.value.error ? "rejected (already live)" : "created",
        });
      }),
    );
    for (const id of ids) await cancelSim(base, id);
    results.push({
      id: "s6",
      title: "Scenario 6 — concurrent emergency creation",
      metric: "Concurrent creation latency (5 simultaneous SOS, same user)",
      unit: "ms",
      requests: samples.length,
      samples,
      check: {
        label: "Only one live session created",
        passed: ids.length === 1,
        detail: `${ids.length} created, ${samples.length - ids.length} blocked as duplicates`,
      },
    });
  }

  const run: PerfRun = { started_at, environment, results };
  const saved = await supabase
    .from("perf_test_runs")
    .insert({
      user_id: userId,
      started_at,
      environment: environment as never,
      results: results as never,
    })
    .select("id, finished_at")
    .single();
  return { ...run, id: saved.data?.id, finished_at: saved.data?.finished_at };
}

export async function listPerfRuns(): Promise<PerfRun[]> {
  const { data, error } = await supabase
    .from("perf_test_runs")
    .select("id, started_at, finished_at, environment, results")
    .order("created_at", { ascending: false })
    .limit(20);
  if (error) throw error;
  return (data ?? []) as unknown as PerfRun[];
}

/** Markdown technical report built only from implemented behaviour + measured runs. */
export function buildTechnicalReport(run: PerfRun | null): string {
  const lines = [
    "# RESQORA — Technical Report (Problem Statement 5)",
    "",
    "## System architecture",
    "- Frontend: React 19 + TanStack Start/Router/Query, installable PWA with offline queue.",
    "- Backend: Lovable Cloud (Postgres with row-level security, Realtime, auth, server functions).",
    "- AI: server-side calls only, with time limits, one retry and validated output.",
    "",
    "## Emergency Session workflow",
    "SOS → Emergency Session row (one live per user, idempotency key) → GPS / last-known location →",
    "notifications (server-recorded) → coordination (responders, volunteers, hospital handoff) → resolution.",
    "Status changes only through the server step `transition_emergency` (forward-only, audited in `emergency_transitions`).",
    "",
    "## Communication flow & resilience",
    "- Offline: SOS and location fixes are queued locally and uploaded with retry back-off once online.",
    "- Retries reuse the same idempotency key, so no duplicate sessions are created.",
    "- Feature-phone SMS (signed webhook) enters the same Emergency Session workflow.",
    "- Email/SMS outcomes are recorded server-side; the browser cannot mark a message delivered.",
    "",
    "## Access-control model",
    "- Patients see only their own records; admins via a separate roles table.",
    "- Guardians/viewers use long, expiring tokens with limited fields; no full medical record.",
    "- Enforced by database row-level security and server checks, not the frontend.",
    "",
    "## Concurrency handling",
    "- Unique partial index: one live emergency per user; unique idempotency key per user.",
    "- Row locking in status transitions; exactly one concurrent update applies.",
    "- Atomic claiming for volunteer/responder acceptance.",
    "",
    "## Performance test methodology",
    "Run from the browser against the live backend as one signed-in user, using simulation-flagged",
    "emergencies (no real alerts) that are cancelled afterwards. Scenario 3 injects +800 ms latency and",
    "drops the first reply. Multi-user scenarios use independent connections for the same account.",
    "",
  ];
  if (!run) {
    lines.push("## Measured results", "No test run recorded yet.");
    return lines.join("\n");
  }
  lines.push(
    "## Measured results",
    `Test date: ${new Date(run.started_at).toLocaleString()}`,
    "",
    "### Test environment",
    ...Object.entries(run.environment).map(([k, v]) => `- ${k}: ${v}`),
    "",
    "| Scenario | Metric | Requests | Avg (ms) | Min (ms) | Max (ms) | p95 (ms) | OK | Failed | Check |",
    "|---|---|---|---|---|---|---|---|---|---|",
    ...run.results.map((r) => {
      const s = stats(r.samples);
      return `| ${r.title} | ${r.metric} | ${r.requests} | ${s.avg} | ${s.min} | ${s.max} | ${s.p95} | ${s.ok} | ${s.failed} | ${r.check.passed ? "PASS" : "FAIL"} — ${r.check.detail} |`;
    }),
    "",
    "Notification delivery latency was not measured: no email/SMS provider is configured, and the test",
    "must not send real alerts. Real multi-account and real-device tests remain outstanding.",
  );
  return lines.join("\n");
}
