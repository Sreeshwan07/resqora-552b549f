import { useCallback, useEffect, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { isOffline, pendingCount, syncOfflineQueue } from "@/lib/offline";

/** Retry delays (ms) used while records are still waiting to upload. */
const BACKOFF = [5_000, 15_000, 30_000, 60_000, 120_000];

/** Tracks connectivity and flushes anything captured offline once back online. */
export function useOfflineSync() {
  const queryClient = useQueryClient();
  const [offline, setOffline] = useState(false);
  const [pending, setPending] = useState(0);
  const attempt = useRef(0);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const flush = useCallback(async () => {
    const synced = await syncOfflineQueue();
    const left = pendingCount();
    setPending(left);
    if (synced > 0) {
      toast.success(`${synced} offline emergency record${synced === 1 ? "" : "s"} synced`);
      await queryClient.invalidateQueries();
    }
    if (timer.current) clearTimeout(timer.current);
    if (left > 0) {
      // Still waiting: keep retrying on a widening delay instead of giving up.
      const delay = BACKOFF[Math.min(attempt.current, BACKOFF.length - 1)]!;
      attempt.current += 1;
      timer.current = setTimeout(() => void flush(), delay);
    } else {
      attempt.current = 0;
    }
  }, [queryClient]);

  useEffect(() => {
    setOffline(isOffline());
    setPending(pendingCount());
    const online = () => {
      setOffline(false);
      attempt.current = 0;
      void flush();
    };
    const down = () => setOffline(true);
    window.addEventListener("online", online);
    window.addEventListener("offline", down);
    void flush();
    return () => {
      window.removeEventListener("online", online);
      window.removeEventListener("offline", down);
      if (timer.current) clearTimeout(timer.current);
    };
  }, [flush]);

  return { offline, pending, flush };
}
