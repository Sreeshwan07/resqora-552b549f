/**
 * Safe Journey monitoring.
 *
 * Mounted once inside the app shell so a journey keeps being monitored on every
 * screen. It reuses the shared RESQORA location watcher (no second GPS
 * implementation), writes locations only when the user has genuinely moved, and
 * drives the server-side state machine for check-ins and escalation.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@/hooks/use-auth";
import { useLivePosition } from "@/hooks/use-live-position";
import { useRealtimeTables } from "@/hooks/use-realtime-tables";
import { profileQuery } from "@/lib/api";
import { haversineKm } from "@/lib/geo";
import { showPush } from "@/lib/push";

import {
  ARRIVAL_RADIUS_KM,
  activeJourneyQuery,
  distanceToDestinationKm,
  isLive,
  journeyMessage,
  locationFreshness,
  notifyJourneyEvent,
  pushJourneyLocation,
  trackJourneyEvent,
  transitionJourney,
  type SafeJourney,
} from "@/lib/safe-journey";

/** Write a new point only after real movement or a reasonable time gap. */
const MIN_WRITE_DISTANCE_KM = 0.15;
const MIN_WRITE_GAP_MS = 120_000;
const TICK_MS = 15_000;

function useOnline() {
  const [online, setOnline] = useState(true);
  useEffect(() => {
    const sync = () => setOnline(navigator.onLine);
    sync();
    window.addEventListener("online", sync);
    window.addEventListener("offline", sync);
    return () => {
      window.removeEventListener("online", sync);
      window.removeEventListener("offline", sync);
    };
  }, []);
  return online;
}

export function useSafeJourneyMonitor() {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const journeyQuery = useQuery(activeJourneyQuery(user?.id));
  const profile = useQuery(profileQuery(user?.id));
  const { position, status: locationStatus } = useLivePosition();
  const online = useOnline();

  const journey = journeyQuery.data ?? null;
  const lastWrite = useRef<{ lat: number; lng: number; at: number } | null>(null);
  const busy = useRef<Set<string>>(new Set());

  const refresh = useCallback(() => {
    void queryClient.invalidateQueries({ queryKey: ["safe-journey-active", user?.id] });
    void queryClient.invalidateQueries({ queryKey: ["safe-journey-events"] });
    void queryClient.invalidateQueries({ queryKey: ["safe-journey-history", user?.id] });
  }, [queryClient, user?.id]);

  // Realtime: a change written by another device or by the database itself is
  // reflected here without a refresh.
  useRealtimeTables({
    channel: user ? `safe-journey-${user.id}` : null,
    watch: user
      ? [
          { table: "safe_journeys", filter: `user_id=eq.${user.id}` },
          { table: "safe_journey_events", filter: `user_id=eq.${user.id}` },
        ]
      : [],
    invalidate: ["safe-journey-active", "safe-journey-history", "safe-journey-events"],
  });


  /** Serialises one-shot work so a tick can never fire the same step twice. */
  const once = useCallback(async (key: string, work: () => Promise<void>) => {
    if (busy.current.has(key)) return;
    busy.current.add(key);
    try {
      await work();
    } catch (error) {
      console.error("Safe Journey step failed:", (error as Error).message);
    } finally {
      busy.current.delete(key);
    }
  }, []);

  // ---------------------------------------------------------------- location
  useEffect(() => {
    if (!journey || !isLive(journey) || !journey.sharing_enabled) return;
    if (!position || position.source !== "gps" || !online) return;
    const previous = lastWrite.current;
    const moved = previous
      ? distanceToDestinationKm(
          { ...journey, destination_latitude: previous.lat, destination_longitude: previous.lng },
          position,
        ) ?? 0
      : Infinity;
    const stale = !previous || Date.now() - previous.at > MIN_WRITE_GAP_MS;
    if (!stale && moved < MIN_WRITE_DISTANCE_KM) return;

    lastWrite.current = { lat: position.lat, lng: position.lng, at: Date.now() };
    void once(`location-${journey.id}`, async () => {
      await pushJourneyLocation({
        journeyId: journey.id,
        latitude: position.lat,
        longitude: position.lng,
        accuracy: position.accuracy,
        capturedAt: position.updatedAt,
      });
      refresh();
    });
  }, [journey, position, online, once, refresh]);

  // -------------------------------------------------------- state machine
  useEffect(() => {
    if (!journey || !user) return;
    if (!isLive(journey)) return;

    const run = async () => {
      const now = Date.now();
      const status = journey.status;
      const arrival = new Date(journey.expected_arrival_at).getTime();

      // Destination geofence: we ASK, never auto-complete.
      if (status === "active") {
        const distance = distanceToDestinationKm(journey, position);
        if (distance != null && distance <= ARRIVAL_RADIUS_KM) {
          await once(`arriving-${journey.id}`, async () => {
            await transitionJourney(journey.id, "arriving", "Near destination");
            refresh();
          });
          return;
        }
      }

      // Periodic check-in, when the user asked for one.
      const interval = journey.check_in_interval_minutes;
      const since = new Date(
        journey.last_check_in_at ?? journey.started_at ?? journey.created_at,
      ).getTime();
      const periodicDue = interval ? now - since >= interval * 60_000 : false;

      if ((status === "active" || status === "arriving") && (now >= arrival || periodicDue)) {
        await once(`checkin-${journey.id}-${status}`, async () => {
          const updated = await transitionJourney(
            journey.id,
            "check_in_required",
            now >= arrival ? "Expected arrival time reached" : "Scheduled check-in",
          );
          const message = journeyMessage(
            updated,
            "JOURNEY_CHECK_IN_REQUIRED",
            profile.data?.full_name || "You",
          );
          showPush(message.title, "Your Safe Journey needs a check-in. Are you safe?");
          await notifyJourneyEvent({
            journey: updated,
            event: "JOURNEY_CHECK_IN_REQUIRED",
            profile: profile.data,
          });
          refresh();
        });
        return;
      }

      // Grace period expired with no response: tell the guardian the truth —
      // no confirmation received. Never an accident claim.
      if (status === "check_in_required") {
        const from = new Date(journey.check_in_required_at ?? journey.expected_arrival_at).getTime();
        if (now - from >= journey.grace_period_minutes * 60_000) {
          await once(`missed-${journey.id}`, async () => {
            const missed = await transitionJourney(
              journey.id,
              "check_in_missed",
              "No confirmation received within the grace period",
            );
            trackJourneyEvent(user.id, "check_in_missed");
            await notifyJourneyEvent({
              journey: missed,
              event: "JOURNEY_CHECK_IN_MISSED",
              profile: profile.data,
            });
            const notified = await transitionJourney(
              journey.id,
              "guardian_notified",
              `Guardian ${missed.guardian_name} notified`,
            );
            await notifyJourneyEvent({
              journey: notified,
              event: "GUARDIAN_NOTIFIED",
              profile: profile.data,
              guardian: true,
            });
            trackJourneyEvent(user.id, "guardian_notified");
            refresh();
          });
        }
      }
    };

    void run();
    const id = window.setInterval(() => void run(), TICK_MS);
    return () => window.clearInterval(id);
  }, [journey, user, position, profile.data, once, refresh]);

  const freshness = locationFreshness({
    lastLocationAt: journey?.last_location_at ?? null,
    accuracy: journey?.last_accuracy ?? null,
    online,
    gpsAvailable: locationStatus === "granted",
  });

  return {
    journey,
    loading: journeyQuery.isLoading,
    profile: profile.data,
    position,
    online,
    freshness,
    distanceKm: journey ? distanceToDestinationKm(journey, position) : null,
    refresh,
  };
}

export type SafeJourneyMonitor = ReturnType<typeof useSafeJourneyMonitor>;

export function journeyNeedsAttention(journey: SafeJourney | null | undefined) {
  return Boolean(
    journey &&
      ["check_in_required", "check_in_missed", "guardian_notified"].includes(journey.status),
  );
}
