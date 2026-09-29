/**
 * Integration tests against the real database RPC (skipped when the server
 * credentials are not present in the environment).
 */
import { describe, expect, it } from "vitest";
import { createClient } from "@supabase/supabase-js";

const url = process.env["SUPABASE_URL"];
const service = process.env["SUPABASE_SERVICE_ROLE_KEY"];
const publishable = process.env["SUPABASE_PUBLISHABLE_KEY"];
const run = url && service && publishable ? describe : describe.skip;

function client(key: string) {
  return createClient(url!, key, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: {
      fetch: (input, init) => {
        const h = new Headers(init?.headers);
        if (key.startsWith("sb_") && h.get("Authorization") === `Bearer ${key}`) h.delete("Authorization");
        h.set("apikey", key);
        return fetch(input, { ...init, headers: h });
      },
    },
  });
}

const consume = (c: ReturnType<typeof client>, id: string, max: number) =>
  c.rpc("consume_rate_limit", { _identifier: id, _endpoint: "vitest", _window_seconds: 3600, _max: max });

run("durable rate limiter (database)", () => {
  it("TEST 6: 25 simultaneous requests with max 5 → exactly 5 allowed", async () => {
    const id = `test:concurrency-${crypto.randomUUID()}`;
    const results = await Promise.all(Array.from({ length: 25 }, () => consume(client(service!), id, 5)));
    const allowed = results.filter((r) => (r.data as { allowed: boolean }).allowed).length;
    expect(results.every((r) => !r.error)).toBe(true);
    expect(allowed).toBe(5);
  });

  it("TEST 7: state survives a brand-new client/instance", async () => {
    const id = `test:restart-${crypto.randomUUID()}`;
    for (let i = 0; i < 3; i++) await consume(client(service!), id, 3);
    const fresh = client(service!); // new connection, no shared memory
    const r = await consume(fresh, id, 3);
    expect((r.data as { allowed: boolean; count: number }).count).toBe(4);
    expect((r.data as { allowed: boolean }).allowed).toBe(false);
  });

  it("normal clients cannot call the RPC or touch the table", async () => {
    const anon = client(publishable!);
    const rpc = await consume(anon, "test:anon-attempt", 1000);
    expect(rpc.error).not.toBeNull();
    const read = await anon.from("rate_limit_buckets").select("id").limit(1);
    expect(read.error).not.toBeNull();
    const write = await anon.from("rate_limit_buckets").insert({
      identifier: "user:x", endpoint: "x", window_start: new Date().toISOString(), request_count: 0,
    });
    expect(write.error).not.toBeNull();
  });
});
