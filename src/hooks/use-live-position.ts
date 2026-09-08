import { useEffect, useState } from "react";
import { reverseGeocode } from "@/lib/geocode";

export type LivePosition = {
  lat: number;
  lng: number;
  accuracy: number;
  updatedAt: Date;
  source: "gps" | "manual";
};

export type LocationStatus = "idle" | "locating" | "granted" | "manual" | "denied" | "unavailable";

export type ManualLocation = { lat: number; lng: number; label: string };

const MANUAL_KEY = "resqora.manual-location";
const LEGACY_MANUAL_KEY = "aegis.manual-location";
/** Ignore fixes that neither move meaningfully nor improve accuracy. */
const MIN_MOVE_M = 8;
const MIN_GAP_MS = 5_000;

type State = {
  status: LocationStatus;
  position: LivePosition | null;
  address: string | null;
  manual: ManualLocation | null;
  resolving: boolean;
};

let state: State = {
  status: "idle",
  position: null,
  address: null,
  manual: null,
  resolving: false,
};

const listeners = new Set<() => void>();
let started = false;
let watchId: number | null = null;
let intervalId: number | null = null;
/** High-accuracy continuous tracking is reserved for an active emergency. */
let highAccuracy = false;
/** Transient GPS failures (timeout / temporarily unavailable) before giving up. */
const MAX_SOFT_FAILURES = 3;
let softFailures = 0;
let retryTimer: number | null = null;
let teardownTimer: number | null = null;
let visibilityBound = false;
/** After this long with no fix, offer the manual fallback (GPS keeps trying). */
const ACQUIRE_CEILING_MS = 25_000;
let ceilingTimer: number | null = null;

function set(patch: Partial<State>) {
  state = { ...state, ...patch };
  listeners.forEach((listener) => listener());
}

// Address lookup is shared with the emergency flow (Google, then OpenStreetMap).


let lastResolvedKey: string | null = null;

function resolveAddress(lat: number, lng: number) {
  const key = `${lat.toFixed(3)},${lng.toFixed(3)}`;
  if (key === lastResolvedKey) return;
  lastResolvedKey = key;
  set({ resolving: true });
  void reverseGeocode(lat, lng).then((value: string | null) => {
    set({ resolving: false, ...(value ? { address: value } : {}) });
  });
}

function acceptFix(pos: GeolocationPosition) {
  // A good fix clears any pending retry / soft-failure streak.
  softFailures = 0;
  if (retryTimer !== null) {
    window.clearTimeout(retryTimer);
    retryTimer = null;
  }
  if (ceilingTimer !== null) {
    window.clearTimeout(ceilingTimer);
    ceilingTimer = null;
  }
  const previous = state.position;
  if (previous && previous.source === "gps") {
    const movedM = distanceMeters(previous, pos.coords);
    const sinceMs = Date.now() - previous.updatedAt.getTime();
    const sharper = pos.coords.accuracy < previous.accuracy - 5;
    if (movedM < MIN_MOVE_M && sinceMs < MIN_GAP_MS && !sharper) return;
  }
  set({
    status: "granted",
    position: {
      lat: pos.coords.latitude,
      lng: pos.coords.longitude,
      accuracy: pos.coords.accuracy,
      updatedAt: new Date(),
      source: "gps",
    },
  });
  resolveAddress(pos.coords.latitude, pos.coords.longitude);
}

/** Metres between two coordinates (equirectangular approximation). */
function distanceMeters(
  a: { lat: number; lng: number },
  b: { latitude: number; longitude: number },
) {
  const toRad = Math.PI / 180;
  const x = (b.longitude - a.lng) * toRad * Math.cos(((a.lat + b.latitude) / 2) * toRad);
  const y = (b.latitude - a.lat) * toRad;
  return Math.sqrt(x * x + y * y) * 6_371_000;
}

function applyManual(manual: ManualLocation) {
  set({
    manual,
    status: state.status === "granted" ? state.status : "manual",
    address: manual.label,
    position:
      state.position && state.position.source === "gps"
        ? state.position
        : {
            lat: manual.lat,
            lng: manual.lng,
            accuracy: 0,
            updatedAt: new Date(),
            source: "manual",
          },
  });
}

function handleError(error: GeolocationPositionError) {
  // A hard permission denial is final: stop burning the GPS radio and let the
  // LocationGate offer the manual fallback.
  if (error.code === error.PERMISSION_DENIED) {
    softFailures = 0;
    stopWatch();
    if (state.position) return;
    set({ status: state.manual ? "manual" : "denied" });
    return;
  }

  // Timeouts and "position unavailable" are routine on mobile (indoors, cold
  // GPS start, tab resumed). Keep locating and retry before declaring failure.
  if (state.position) return;
  softFailures += 1;
  if (softFailures < MAX_SOFT_FAILURES) {
    set({ status: state.manual ? "manual" : "locating" });
    if (retryTimer === null && typeof window !== "undefined") {
      retryTimer = window.setTimeout(() => {
        retryTimer = null;
        if (state.position || !navigator.geolocation) return;
        navigator.geolocation.getCurrentPosition(acceptFix, handleError, {
          enableHighAccuracy: highAccuracy,
          maximumAge: 0,
          timeout: 20_000,
        });
      }, 4000);
    }
    return;
  }
  if (state.manual) {
    set({ status: "manual" });
    return;
  }
  set({ status: "unavailable" });
}

function startWatch() {
  if (watchId !== null) return;
  set({ status: state.position ? state.status : "locating" });
  watchId = navigator.geolocation.watchPosition(acceptFix, handleError, {
    enableHighAccuracy: highAccuracy,
    maximumAge: 10_000,
    // Cold GPS starts on phones regularly exceed 15s; give the first fix room.
    timeout: highAccuracy ? 15_000 : 30_000,
  });
  // Kick off an immediate lower-accuracy attempt so the UI is not stuck on
  // "Getting your location…" while the watcher waits for a precise fix.
  navigator.geolocation.getCurrentPosition(acceptFix, handleError, {
    enableHighAccuracy: false,
    maximumAge: 60_000,
    timeout: 12_000,
  });
  // Some devices never resolve and never error (weak signal, virtualised GPS).
  // Never leave an emergency user stuck on "Getting your location…": surface the
  // manual-address fallback while the watcher keeps trying in the background.
  if (ceilingTimer === null) {
    ceilingTimer = window.setTimeout(() => {
      ceilingTimer = null;
      if (state.position) return;
      set({ status: state.manual ? "manual" : "unavailable" });
    }, ACQUIRE_CEILING_MS);
  }
// Only while an SOS is active: force a fresh fix every 10s even when the
  // device reports no movement. Normal browsing just follows the watcher.
  syncEmergencyInterval();
}

/**
 * The 10s emergency heartbeat only runs while the tab is visible. A
 * backgrounded desktop tab would otherwise keep polling GPS every 10s and
 * drain the battery for nobody; mobile browsers suspend the tab anyway and
 * the visibility-recovery handler forces a fresh fix when the user returns.
 */
function syncEmergencyInterval() {
  if (intervalId !== null) {
    window.clearInterval(intervalId);
    intervalId = null;
  }
  if (!highAccuracy) return;
  if (typeof document !== "undefined" && document.visibilityState !== "visible") return;
  intervalId = window.setInterval(() => {
    navigator.geolocation.getCurrentPosition(acceptFix, () => undefined, {
      enableHighAccuracy: true,
      maximumAge: 0,
      timeout: 9000,
    });
  }, 10_000);
}

function stopWatch() {
  if (watchId !== null) navigator.geolocation.clearWatch(watchId);
  if (intervalId !== null) window.clearInterval(intervalId);
  if (ceilingTimer !== null) window.clearTimeout(ceilingTimer);
  watchId = null;
  intervalId = null;
  ceilingTimer = null;
}

/**
 * Turns high-accuracy continuous tracking on while an emergency is active and
 * back off (releasing the GPS radio) once it ends.
 */
export function setHighAccuracyTracking(enabled: boolean) {
  if (typeof window === "undefined" || highAccuracy === enabled) return;
  highAccuracy = enabled;
  if (!started || !navigator.geolocation) return;
  stopWatch();
  startWatch();
}

/**
 * Mobile browsers suspend geolocation watchers for backgrounded tabs, and some
 * silently stop delivering fixes afterwards. On resume, ask for one fresh fix.
 */
function bindVisibilityRecovery() {
  if (visibilityBound || typeof document === "undefined") return;
  visibilityBound = true;
document.addEventListener("visibilitychange", () => {
    // Pause the 10s emergency heartbeat while hidden; restart it on return.
    syncEmergencyInterval();
    if (document.visibilityState !== "visible") return;
    if (!started || !navigator.geolocation || state.status === "denied") return;
    const stale = !state.position || Date.now() - state.position.updatedAt.getTime() > 60_000;
    if (!stale) return;
    navigator.geolocation.getCurrentPosition(acceptFix, handleError, {
      enableHighAccuracy: highAccuracy,
      maximumAge: 0,
      timeout: 20_000,
    });
  });
}

/** Starts the shared geolocation watcher exactly once per page session. */
function start() {
  if (typeof window === "undefined") return;
  // A route change may have scheduled a teardown; cancel it and keep the fix.
  if (teardownTimer !== null) {
    window.clearTimeout(teardownTimer);
    teardownTimer = null;
  }
  if (started) return;
  started = true;

  try {
    const stored =
      window.localStorage.getItem(MANUAL_KEY) ?? window.localStorage.getItem(LEGACY_MANUAL_KEY);
    if (stored) applyManual(JSON.parse(stored) as ManualLocation);
  } catch {
    /* ignore malformed cache */
  }

  // Geolocation needs a secure context: http:// on a phone silently never fires.
  if (!navigator.geolocation || (!window.isSecureContext && window.location.hostname !== "localhost")) {
    if (!state.manual) set({ status: "unavailable" });
    return;
  }

  bindVisibilityRecovery();

  // Ask the Permissions API first: an already-blocked permission must not
  // re-trigger a prompt on every load, and a granted one skips the "locating"
  // flash. Browsers without it (older Safari) fall straight through to a watch.
  const permissions = navigator.permissions as Navigator["permissions"] | undefined;
  if (permissions?.query) {
    void permissions
      .query({ name: "geolocation" as PermissionName })
      .then((permission) => {
        const apply = () => {
          if (permission.state === "denied") {
            stopWatch();
            if (!state.position) set({ status: state.manual ? "manual" : "denied" });
            return;
          }
          softFailures = 0;
          startWatch();
        };
        apply();
        permission.onchange = () => {
          if (!started) return;
          apply();
        };
      })
      .catch(() => startWatch());
    return;
  }
  startWatch();
}

/** Re-prompt (or re-check) browser permission after the user taps Enable location. */
export async function requestLocationPermission(): Promise<LocationStatus> {
  if (typeof window === "undefined" || !navigator.geolocation) {
    set({ status: "unavailable" });
    return "unavailable";
  }
  // A manual retry deserves a clean slate, not the previous failure streak.
  softFailures = 0;
  started = true;
  bindVisibilityRecovery();
  set({ status: state.position?.source === "gps" ? "granted" : "locating" });
  return new Promise<LocationStatus>((resolve) => {
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        acceptFix(pos);
        startWatch();
        resolve("granted");
      },
      (error) => {
        handleError(error);
        resolve(state.status);
      },
      { enableHighAccuracy: true, maximumAge: 0, timeout: 15_000 },
    );
  });
}

/** Anchor the app to a manually entered address when GPS is unavailable. */
export function setManualLocation(manual: ManualLocation) {
  applyManual(manual);
  try {
    window.localStorage.setItem(MANUAL_KEY, JSON.stringify(manual));
  } catch {
    /* storage disabled */
  }
}

export function clearManualLocation() {
  set({ manual: null });
  try {
    window.localStorage.removeItem(MANUAL_KEY);
    window.localStorage.removeItem(LEGACY_MANUAL_KEY);
  } catch {
    /* storage disabled */
  }
}

/**
 * Shared live location. The browser is prompted only once per session; every
 * consumer subscribes to the same fix, address and permission state.
 */
export function useLivePosition() {
  const [snapshot, setSnapshot] = useState(state);

  useEffect(() => {
    const listener = () => setSnapshot(state);
    listeners.add(listener);
    start();
    listener();
    return () => {
      listeners.delete(listener);
      // Navigating between pages unmounts/remounts consumers within the same
      // tick. Keep the watcher alive briefly so routing never restarts GPS
      // (which re-prompted and reset the fix); only a real exit tears it down.
      if (listeners.size > 0 || teardownTimer !== null) return;
      teardownTimer = window.setTimeout(() => {
        teardownTimer = null;
        if (listeners.size > 0) return;
        stopWatch();
        if (retryTimer !== null) {
          window.clearTimeout(retryTimer);
          retryTimer = null;
        }
        started = false;
      }, 15_000);
    };
  }, []);

  return {
    position: snapshot.position,
    address: snapshot.address,
    manual: snapshot.manual,
    status: snapshot.status,
    resolvingAddress: snapshot.resolving,
    /** True only when there is no usable location at all. */
    denied: snapshot.status === "denied" || snapshot.status === "unavailable",
    permissionBlocked: snapshot.status === "denied",
    unavailable: snapshot.status === "unavailable",
    requestPermission: requestLocationPermission,
    setManualLocation,
    clearManualLocation,
  };
}
