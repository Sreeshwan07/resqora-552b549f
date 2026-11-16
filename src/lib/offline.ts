import { supabase } from "@/integrations/supabase/client";

const EMERGENCY_KEY = "resqora.offline.emergency";
const PINGS_KEY = "resqora.offline.pings";
/** Pre-rename keys: migrated once so a pending offline SOS is never lost. */
const LEGACY_KEYS: Record<string, string> = {
  [EMERGENCY_KEY]: "aegis.offline.emergency",
  [PINGS_KEY]: "aegis.offline.pings",
};

export type QueuedEmergency = {
  /** Temporary local identifier used by queued pings until the real row exists. */
  localId: string;
  userId: string;
  type: string;
  severity: string;
  notes: string | null;
  latitude: number | null;
  longitude: number | null;
  accuracy?: number | null;
  speed?: number | null;
  address: string | null;
  startedAt: string;
};

export type QueuedPing = {
  userId: string;
  /** Either a real emergency id, or a queued emergency's localId. */
  emergencyId: string;
  latitude: number;
  longitude: number;
  accuracy: number | null;
  createdAt: string;
};

export function isOffline() {
  return typeof navigator !== "undefined" && navigator.onLine === false;
}

function read<T>(key: string): T[] {
  if (typeof window === "undefined") return [];
  try {
    let raw = window.localStorage.getItem(key);
    const legacyKey = LEGACY_KEYS[key];
    if (!raw && legacyKey) {
      raw = window.localStorage.getItem(legacyKey);
      if (raw) {
        window.localStorage.setItem(key, raw);
        window.localStorage.removeItem(legacyKey);
      }
    }
    return raw ? (JSON.parse(raw) as T[]) : [];
  } catch {
    return [];
  }
}

function write<T>(key: string, value: T[]) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(key, JSON.stringify(value));
  } catch {
    throw new Error(
      "This device could not store the offline SOS. Free some browser storage and try again.",
    );
  }
}

export function queueEmergency(entry: Omit<QueuedEmergency, "localId">) {
  if (!entry.userId || !entry.type || !entry.startedAt) {
    throw new Error("The offline SOS is missing required emergency details.");
  }
  if ((entry.latitude == null) !== (entry.longitude == null)) {
    throw new Error("The offline SOS has incomplete GPS coordinates.");
  }
  if (
    entry.latitude != null &&
    (!Number.isFinite(entry.latitude) ||
      !Number.isFinite(entry.longitude) ||
      entry.latitude < -90 ||
      entry.latitude > 90 ||
      entry.longitude! < -180 ||
      entry.longitude! > 180)
  ) {
    throw new Error("The offline SOS has invalid GPS coordinates.");
  }
  const localId = `local-${crypto.randomUUID()}`;
  write(EMERGENCY_KEY, [...read<QueuedEmergency>(EMERGENCY_KEY), { ...entry, localId }]);
  return localId;
}

/** The most recent queued offline SOS for this user, used to tag queued pings. */
export function latestQueuedEmergencyId(userId: string) {
  const items = read<QueuedEmergency>(EMERGENCY_KEY).filter((item) => item.userId === userId);
  return items.length > 0 ? (items[items.length - 1]?.localId ?? null) : null;
}

export function queuePing(entry: QueuedPing) {
  const pings = read<QueuedPing>(PINGS_KEY);
  // Never queue the same fix twice (same emergency + timestamp).
  if (pings.some((p) => p.emergencyId === entry.emergencyId && p.createdAt === entry.createdAt))
    return;
  write(PINGS_KEY, [...pings, entry]);
}

export function pendingCount() {
  return read<QueuedEmergency>(EMERGENCY_KEY).length + read<QueuedPing>(PINGS_KEY).length;
}

let syncing = false;

/**
 * Reconnects through the exact same activation workflow as an online SOS. The
 * stable local ID makes creation retry-safe, and the shared workflow captures
 * location, creates Guardian tracking and attempts every saved contact alert.
 * Anything that throws stays queued for the next automatic backoff attempt.
 */
export async function syncOfflineQueue() {
  if (isOffline() || syncing) return 0;
  syncing = true;
  try {
    let synced = 0;

    const emergencies = read<QueuedEmergency>(EMERGENCY_KEY);
    const remainingEmergencies: QueuedEmergency[] = [];
    const idMap = new Map<string, string>();

    for (const item of emergencies) {
      let createdId: string | null = null;
      try {
        const { data: profile } = await supabase
          .from("profiles")
          .select("*")
          .eq("id", item.userId)
          .maybeSingle();
        const { createEmergency } = await import("@/lib/emergency");
        const result = await createEmergency({
          userId: item.userId,
          type: item.type,
          severity: item.severity,
          notes: item.notes ?? undefined,
          contactCount: 0,
          profile,
          idempotencyKey: item.localId,
          startedAt: item.startedAt,
          capturedLocation:
            item.latitude != null && item.longitude != null
              ? {
                  latitude: item.latitude,
                  longitude: item.longitude,
                  accuracy: item.accuracy ?? null,
                  speed: item.speed ?? null,
                  address: item.address,
                  capturedAt: item.startedAt,
                }
              : undefined,
        });
        if (!result.queued) createdId = result.id;
      } catch {
        // Network/auth/database failures leave the complete entry untouched.
      }

      if (!createdId) {
        remainingEmergencies.push(item);
        continue;
      }
      idMap.set(item.localId, createdId);
      await supabase.from("emergency_events").insert({
        emergency_id: createdId,
        user_id: item.userId,
        label: "Offline SOS synced",
        detail: "This alert was captured without connectivity and uploaded once back online.",
      });
      synced += 1;
    }
    // Remove synced emergencies immediately so a retry can never duplicate them.
    write(EMERGENCY_KEY, remainingEmergencies);

    const pings = read<QueuedPing>(PINGS_KEY);
    const remainingPings: QueuedPing[] = [];
    const uploadable: { ping: QueuedPing; emergencyId: string }[] = [];
    const stillQueued = new Set(remainingEmergencies.map((item) => item.localId));

    for (const ping of pings) {
      const mapped = idMap.get(ping.emergencyId);
      if (mapped) {
        uploadable.push({ ping, emergencyId: mapped });
      } else if (ping.emergencyId.startsWith("local-")) {
        if (stillQueued.has(ping.emergencyId)) remainingPings.push(ping);
      } else {
        uploadable.push({ ping, emergencyId: ping.emergencyId });
      }
    }

    if (uploadable.length > 0) {
      const { error } = await supabase.from("location_pings").insert(
        uploadable.map(({ ping, emergencyId }) => ({
          emergency_id: emergencyId,
          user_id: ping.userId,
          latitude: ping.latitude,
          longitude: ping.longitude,
          accuracy: ping.accuracy,
          created_at: ping.createdAt,
        })),
      );
      if (error) {
        // Retry later against the real ids, which are now known.
        for (const { ping, emergencyId } of uploadable)
          remainingPings.push({ ...ping, emergencyId });
      } else {
        synced += uploadable.length;
      }
    }
    write(PINGS_KEY, remainingPings);

    return synced;
  } finally {
    syncing = false;
  }
}
