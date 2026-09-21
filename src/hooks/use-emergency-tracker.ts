import { useEffect, useRef } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/use-auth";
import { setHighAccuracyTracking, useLivePosition } from "@/hooks/use-live-position";
import { activeEmergencyQuery } from "@/lib/api";
import { readBatteryLevel } from "@/lib/device";
import { isOffline, queuePing } from "@/lib/offline";

/** Minimum gap between two writes, so the Guardian sees a fresh fix every 10s. */
const INTERVAL_MS = 10_000;
/** Force a heartbeat write even when the person has not moved. */
const HEARTBEAT_MS = 60_000;
/** Below this movement the coordinates are effectively identical. */
const MIN_MOVE_M = 12;

function distanceMeters(a: { lat: number; lng: number }, b: { lat: number; lng: number }) {
  const toRad = Math.PI / 180;
  const x = (b.lng - a.lng) * toRad * Math.cos(((a.lat + b.lat) / 2) * toRad);
  const y = (b.lat - a.lat) * toRad;
  return Math.sqrt(x * x + y * y) * 6_371_000;
}

/**
 * Keeps the emergency row and its movement trail up to date for as long as an
 * SOS is active — anywhere in the app, not only on the Live page. It reuses the
 * shared GPS watcher (no second geolocation subscription) and stops writing the
 * moment the emergency is resolved or cancelled.
 */
export function useEmergencyTracker() {
  const { user } = useAuth();
  const active = useQuery(activeEmergencyQuery(user?.id));
  const { position } = useLivePosition();
  const emergencyId = active.data?.id;
  const lastWrite = useRef(0);
  const inFlight = useRef(false);
  const lastSent = useRef<{ lat: number; lng: number } | null>(null);

  // High-accuracy continuous GPS runs only while an emergency is active.
  useEffect(() => {
    setHighAccuracyTracking(Boolean(emergencyId));
    return () => setHighAccuracyTracking(false);
  }, [emergencyId]);

  useEffect(() => {
    if (!emergencyId || !user?.id || !position) return;
    // Power mode: never write pings from a backgrounded tab — mobile browsers
    // suspend the GPS watcher there anyway, and the visibility-recovery fix on
    // return delivers one fresh position instead of a burst of stale ones.
    if (typeof document !== "undefined" && document.visibilityState === "hidden") return;
    if (inFlight.current) return;
    if (Date.now() - lastWrite.current < INTERVAL_MS) return;
    const { lat, lng, accuracy } = position;
    // Skip identical coordinates: only a real move (or a 60s heartbeat) is written.
    const previous = lastSent.current;
    if (
      previous &&
      distanceMeters(previous, { lat, lng }) < MIN_MOVE_M &&
      Date.now() - lastWrite.current < HEARTBEAT_MS
    ) {
      return;
    }
    if (isOffline()) {
      // Keep the trail locally; it uploads against the real emergency id later.
      lastWrite.current = Date.now();
      lastSent.current = { lat, lng };
      queuePing({
        userId: user.id,
        emergencyId,
        latitude: lat,
        longitude: lng,
        accuracy,
        createdAt: new Date().toISOString(),
      });
      return;
    }
    inFlight.current = true;
    lastWrite.current = Date.now();
    lastSent.current = { lat, lng };
    void (async () => {
      try {
        await supabase
          .from("emergencies")
          .update({
            latitude: lat,
            longitude: lng,
            location_updated_at: new Date().toISOString(),
          })
          .eq("id", emergencyId);
        await supabase.from("location_pings").insert({
          emergency_id: emergencyId,
          user_id: user.id,
          latitude: lat,
          longitude: lng,
          accuracy,
          battery_level: await readBatteryLevel(),
        });
      } catch {
        /* the next fix retries; never interrupt the emergency for a failed ping */
      } finally {
        inFlight.current = false;
      }
    })();
  }, [emergencyId, user?.id, position]);

  // A new emergency starts its own throttle window.
  useEffect(() => {
    lastWrite.current = 0;
    lastSent.current = null;
  }, [emergencyId]);
}
