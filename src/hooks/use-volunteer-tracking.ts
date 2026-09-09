/**
 * Keeps an available volunteer's position current using the real device
 * geolocation API. Tracking only runs while the volunteer is verified, marked
 * available and has opted in to sharing location — switching off stops the
 * watch immediately, so no battery or location is used when off duty.
 *
 * Writes are throttled: only after moving ~150 m, or every 5 minutes, so the
 * stored position stays fresh enough for matching without constant updates.
 */
import { useEffect, useRef, useState } from "react";
import { haversineKm } from "@/lib/geo";
import { updateVolunteerPosition } from "@/lib/volunteers";

const MIN_MOVE_KM = 0.15;
const MAX_AGE_MS = 5 * 60 * 1000;

type Args = {
  profileId: string | undefined;
  enabled: boolean;
  onWritten?: () => void;
};

export function useVolunteerTracking({ profileId, enabled, onWritten }: Args) {
  const [error, setError] = useState<string | null>(null);
  const last = useRef<{ lat: number; lng: number; at: number } | null>(null);
  const written = useRef(onWritten);
  written.current = onWritten;

  useEffect(() => {
    if (!enabled || !profileId) {
      last.current = null;
      return;
    }
    if (typeof navigator === "undefined" || !navigator.geolocation) {
      setError("This device cannot share its location.");
      return;
    }

    let cancelled = false;
    const watchId = navigator.geolocation.watchPosition(
      (pos) => {
        if (cancelled) return;
        const lat = pos.coords.latitude;
        const lng = pos.coords.longitude;
        const now = Date.now();
        const prev = last.current;
        const movedFar =
          !prev || haversineKm({ lat: prev.lat, lng: prev.lng }, { lat, lng }) >= MIN_MOVE_KM;
        const tooOld = !prev || now - prev.at >= MAX_AGE_MS;
        if (!movedFar && !tooOld) return;

        last.current = { lat, lng, at: now };
        void updateVolunteerPosition(profileId, { lat, lng })
          .then(() => {
            setError(null);
            written.current?.();
          })
          .catch((e: Error) => setError(e.message));
      },
      (err) => {
        if (!cancelled) setError(err.message || "Location permission is needed to be matched.");
      },
      { enableHighAccuracy: false, maximumAge: 60_000, timeout: 30_000 },
    );

    return () => {
      cancelled = true;
      navigator.geolocation.clearWatch(watchId);
    };
  }, [enabled, profileId]);

  return { error };
}
