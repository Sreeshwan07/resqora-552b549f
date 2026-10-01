import { describe, expect, it, vi } from "vitest";
import { dispatchEmergencyEmails, safeTrackingUrl } from "../src/lib/emergency-email.server";

const U = "11111111-1111-1111-1111-111111111111";
const E = "22222222-2222-2222-2222-222222222222";

/** Minimal stand-in for the Supabase query builder covering what dispatch uses. */
function fakeDbs(opts: { owner?: string; status?: string } = {}) {
  const contacts = [
    { id: "a", name: "A", email: "a@x.com", user_id: U },
    { id: "b", name: "B", email: "b@x.com", user_id: U },
    { id: "c", name: "C", email: "c@x.com", user_id: U },
  ];
  const deliveries = new Map<string, Record<string, unknown>>();
  const updates: Record<string, unknown>[] = [];
  const userDb = {
    from(table: string) {
      const q = {
        select: () => q,
        eq: () => q,
        maybeSingle: async () =>
          table === "emergencies"
            ? { data: { id: E, user_id: opts.owner ?? U, type: "medical", status: opts.status ?? "active", latitude: 1, longitude: 2, address: null, location_updated_at: null }, error: null }
            : { data: { full_name: "Test" }, error: null },
        then: (r: (v: unknown) => void) => r({ data: contacts, error: null }),
      };
      return q;
    },
  };
  const adminDb = {
    from() {
      return {
        upsert(rows: Record<string, unknown>[]) {
          const fresh = rows.filter((r) => !deliveries.has(r.dedupe_key as string));
          fresh.forEach((r) => deliveries.set(r.dedupe_key as string, { ...r, id: `d-${r.contact_id}` }));
          return { select: async () => ({ data: fresh.map((r) => ({ ...r, id: `d-${r.contact_id}` })), error: null }) };
        },
        update(patch: Record<string, unknown>) {
          updates.push(patch);
          return { eq: async () => ({ error: null }) };
        },
      };
    },
  };
  return { userDb: userDb as never, adminDb: adminDb as never, updates };
}

const base = { userId: U, emergencyId: E, kind: "alert" as const, trackingUrl: null };

describe("server-side emergency email", () => {
  it("uses only saved contacts and marks accepted sends as sent", async () => {
    const send = vi.fn(async () => ({ ok: true as const, providerMessageId: "m1" }));
    const d = fakeDbs();
    const r = await dispatchEmergencyEmails({ ...d, ...base, send });
    expect(send.mock.calls.map((c) => (c as unknown as [{ to: string }])[0].to).sort()).toEqual(["a@x.com", "b@x.com", "c@x.com"]);
    expect(r.outcomes.every((o) => o.status === "sent")).toBe(true);
    expect(d.updates.every((u) => u.status === "sent" && !("delivered_at" in u))).toBe(true);
  });

  it("rejects recipients that are not the user's contacts", async () => {
    await expect(
      dispatchEmergencyEmails({ ...fakeDbs(), ...base, contactIds: ["evil"], send: vi.fn() }),
    ).rejects.toThrow("UNAUTHORIZED_RECIPIENT");
  });

  it("rejects another user's emergency", async () => {
    await expect(
      dispatchEmergencyEmails({ ...fakeDbs({ owner: "someone-else" }), ...base, send: vi.fn() }),
    ).rejects.toThrow("FORBIDDEN");
  });

  it("records failure and keeps other recipients going", async () => {
    const send = vi.fn(async (m: { to: string }) =>
      m.to === "b@x.com"
        ? { ok: false as const, category: "provider_error" as const, error: "boom" }
        : { ok: true as const, providerMessageId: "m" },
    );
    const r = await dispatchEmergencyEmails({ ...fakeDbs(), ...base, send });
    expect(r.outcomes.filter((o) => o.status === "sent")).toHaveLength(2);
    expect(r.outcomes.find((o) => o.name === "B")?.status).toBe("failed");
  });

  it("never sends twice for the same emergency, recipient and kind", async () => {
    const send = vi.fn(async () => ({ ok: true as const, providerMessageId: "m" }));
    const d = fakeDbs();
    await Promise.all([
      dispatchEmergencyEmails({ ...d, ...base, send }),
      dispatchEmergencyEmails({ ...d, ...base, send }),
    ]);
    await dispatchEmergencyEmails({ ...d, ...base, send });
    expect(send).toHaveBeenCalledTimes(3);
  });

  it("only allows tracking links scoped to this emergency on this site", () => {
    const o = "https://resqora.lovable.app";
    expect(safeTrackingUrl(`${o}/guardian/${E}/tok`, E, o)).toBeTruthy();
    expect(safeTrackingUrl(`${o}/guardian/other/tok`, E, o)).toBeNull();
    expect(safeTrackingUrl("https://evil.com/x", E, o)).toBeNull();
  });
});
