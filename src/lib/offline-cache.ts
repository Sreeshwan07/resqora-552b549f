import type { EmergencyContact, Profile } from "@/lib/api";

/**
 * Minimal offline fallback: only what someone genuinely needs to call for help
 * with no connectivity. Full medical history, addresses, dates of birth, contact
 * emails and guardian details are deliberately NOT cached on the device.
 */
export type OfflineSnapshot = {
  savedAt: string;
  profile: { full_name: string | null; blood_group: string | null } | null;
  contacts: { name: string; phone: string }[];
};

const KEY = "resqora.offline.snapshot";

export function saveOfflineSnapshot(
  profile: Profile | null | undefined,
  contacts: EmergencyContact[],
) {
  if (typeof window === "undefined") return;
  const snapshot: OfflineSnapshot = {
    savedAt: new Date().toISOString(),
    profile: profile ? { full_name: profile.full_name, blood_group: profile.blood_group } : null,
    contacts: contacts.slice(0, 3).map((c) => ({ name: c.name, phone: c.phone })),
  };
  try {
    // Overwrites (and therefore purges) any richer snapshot saved by older builds.
    window.localStorage.setItem(KEY, JSON.stringify(snapshot));
  } catch {
    /* storage full or blocked — offline copy is best-effort */
  }
}

export function readOfflineSnapshot(): OfflineSnapshot | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<OfflineSnapshot> & {
      profile?: Record<string, string | null> | null;
      contacts?: { name: string; phone: string }[];
    };
    // Strip anything an older build may have stored beyond the minimum set.
    return {
      savedAt: parsed.savedAt ?? new Date(0).toISOString(),
      profile: parsed.profile
        ? {
            full_name: parsed.profile.full_name ?? null,
            blood_group: parsed.profile.blood_group ?? null,
          }
        : null,
      contacts: (parsed.contacts ?? []).map((c) => ({ name: c.name, phone: c.phone })),
    };
  } catch {
    return null;
  }
}
