import { useEffect, useRef } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/use-auth";
import { contactsQuery, notify, profileQuery } from "@/lib/api";
import { createEmergency } from "@/lib/emergency";
import { logActivity } from "@/lib/activity";
import { showPush } from "@/lib/push";

const REMINDER_WINDOW_MS = 5 * 60_000;

/**
 * Watches pending safety check-ins. Reminds the user shortly before the
 * deadline and escalates to the standard SOS workflow when a check-in is
 * missed.
 */
export function useCheckinWatcher() {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const escalating = useRef<Set<string>>(new Set());
  const reminded = useRef<Set<string>>(new Set());

  useEffect(() => {
    if (!user) return;
    let cancelled = false;

    async function tick() {
      const { data, error } = await supabase
        .from("safety_checkins")
        .select("*")
        .eq("user_id", user!.id)
        .eq("status", "pending");
      if (error || !data || cancelled) return;

      const now = Date.now();
      for (const checkin of data) {
        const due = new Date(checkin.due_at).getTime();

        if (due > now && due - now <= REMINDER_WINDOW_MS && !reminded.current.has(checkin.id)) {
          reminded.current.add(checkin.id);
          showPush("Safety check-in due soon", `${checkin.label} — confirm you're safe.`);
          toast.warning(`Check-in "${checkin.label}" is due soon`);
        }

        if (due <= now && !escalating.current.has(checkin.id)) {
          escalating.current.add(checkin.id);
          try {
            const contacts = await queryClient.fetchQuery(contactsQuery(user!.id));
            const profile = await queryClient.fetchQuery(profileQuery(user!.id)).catch(() => null);
            const emergency = await createEmergency({
              userId: user!.id,
              type: "sos",
              severity: "high",
              notes: `Missed safety check-in: ${checkin.label}${checkin.note ? ` — ${checkin.note}` : ""}`,
              contactCount: contacts.length,
              contacts,
              profile,
            });
            await supabase
              .from("safety_checkins")
              .update({ status: "missed", emergency_id: emergency.queued ? null : emergency.id })
              .eq("id", checkin.id);
            await notify(user!.id, {
              category: "emergency",
              title: "Missed safety check-in",
              body: emergency.queued
                ? `RESQORA queued an SOS on this device because "${checkin.label}" was not confirmed in time.`
                : `RESQORA raised an SOS because "${checkin.label}" was not confirmed in time.`,
            });
            await logActivity(user!.id, "SOS activated", `Missed check-in: ${checkin.label}`);
            showPush("SOS activated", "You missed a safety check-in — your contacts were alerted.");
            toast.error(`Missed check-in — SOS activated for "${checkin.label}"`);
            await queryClient.invalidateQueries({ queryKey: ["safety-checkins", user!.id] });
            await queryClient.invalidateQueries({ queryKey: ["active-emergency", user!.id] });
          } catch {
            escalating.current.delete(checkin.id);
          }
        }
      }
    }

    void tick();
    const interval = window.setInterval(() => void tick(), 20000);
    return () => {
      cancelled = true;
      window.clearInterval(interval);
    };
  }, [user, queryClient]);
}
