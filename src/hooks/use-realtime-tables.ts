/**
 * Subscribes to real Postgres change events for a set of tables and refreshes
 * the affected React Query caches. Nothing here fabricates activity: every
 * callback is driven by a row actually written in the database.
 *
 * The channel is torn down on unmount and re-created only when the identity of
 * the subscription changes, so no subscription leaks and no reconnect loop.
 */
import { useEffect, useRef } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

export type RealtimeWatch = {
  table: string;
  /** Optional Postgres filter, e.g. `user_id=eq.<uuid>`. */
  filter?: string;
};

type Options = {
  /** Unique channel name. Pass a falsy value to stay unsubscribed. */
  channel: string | null | undefined;
  watch: RealtimeWatch[];
  /** Query keys (prefixes) to invalidate when any watched row changes. */
  invalidate: string[];
  enabled?: boolean;
  /** Called for every change, e.g. to raise a toast for a brand new offer. */
  onChange?: (payload: { table: string; eventType: string; row: unknown }) => void;
};

export function useRealtimeTables({
  channel,
  watch,
  invalidate,
  enabled = true,
  onChange,
}: Options) {
  const queryClient = useQueryClient();
  const changeRef = useRef(onChange);
  changeRef.current = onChange;

  const signature = JSON.stringify(watch);
  const keys = JSON.stringify(invalidate);

  useEffect(() => {
    if (!enabled || !channel) return;
    const tables = JSON.parse(signature) as RealtimeWatch[];
    const queryKeys = JSON.parse(keys) as string[];
    if (tables.length === 0) return;

    const sub = supabase.channel(channel);
    for (const entry of tables) {
      sub.on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: entry.table,
          ...(entry.filter ? { filter: entry.filter } : {}),
        },
        (payload) => {
          for (const key of queryKeys) {
            void queryClient.invalidateQueries({ queryKey: [key] });
          }
          changeRef.current?.({
            table: entry.table,
            eventType: payload.eventType,
            row: payload.new ?? payload.old,
          });
        },
      );
    }
    sub.subscribe();

    return () => {
      void supabase.removeChannel(sub);
    };
  }, [channel, signature, keys, enabled, queryClient]);
}
