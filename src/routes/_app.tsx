import { Outlet, createFileRoute, redirect } from "@tanstack/react-router";
import { AppLayout } from "@/components/layouts/app-layout";
import { supabase } from "@/integrations/supabase/client";
import { useCheckinWatcher } from "@/hooks/use-checkin-watcher";

export const Route = createFileRoute("/_app")({
  ssr: false,
  beforeLoad: async ({ location }) => {
    // This subtree never renders on the server, and the session lives in browser
    // storage, so the guard runs on the client only. Redirecting during SSR would
    // hand the browser an /auth shell it then re-renders, which React reports as a
    // hydration mismatch.
    if (typeof window === "undefined") return;
    const { data, error } = await supabase.auth.getUser();
    if (error || !data.user) {
      throw redirect({ to: "/auth", search: { redirect: location.href } });
    }
    return { user: data.user };
  },
  component: AppShellRoute,
});

function AppShellRoute() {
  // Watches safety check-ins app-wide and escalates missed ones to SOS.
  useCheckinWatcher();
  return (
    <AppLayout>
      <Outlet />
    </AppLayout>
  );
}
