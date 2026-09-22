import { useEffect, useState } from "react";
import { Outlet, createFileRoute, useNavigate, useRouterState } from "@tanstack/react-router";
import { Loader2 } from "lucide-react";
import { AppLayout } from "@/components/layouts/app-layout";
import { supabase } from "@/integrations/supabase/client";
import { useCheckinWatcher } from "@/hooks/use-checkin-watcher";

export const Route = createFileRoute("/_app")({
  ssr: false,
  component: AppShellRoute,
});

/**
 * Client-side auth gate. The session lives in browser storage, so the check can
 * only run here. It deliberately redirects from an effect rather than from
 * `beforeLoad`: redirecting while the page is still hydrating swaps the rendered
 * tree mid-hydration, which React reports as a hydration mismatch.
 */
function AppShellRoute() {
  const navigate = useNavigate();
  const href = useRouterState({ select: (state) => state.location.href });
  const [checked, setChecked] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void supabase.auth.getUser().then(({ data, error }) => {
      if (cancelled) return;
      if (error || !data.user) {
        void navigate({ to: "/auth", search: { redirect: href }, replace: true });
        return;
      }
      setChecked(true);
    });
    return () => {
      cancelled = true;
    };
  }, [href, navigate]);

  if (!checked) {
    return (
      <div className="grid min-h-dvh place-items-center bg-background">
        <Loader2 className="size-6 animate-spin text-muted-foreground" aria-label="Loading" />
      </div>
    );
  }

  return <AuthenticatedShell />;
}

function AuthenticatedShell() {
  // Watches safety check-ins app-wide and escalates missed ones to SOS.
  useCheckinWatcher();
  return (
    <AppLayout>
      <Outlet />
    </AppLayout>
  );
}
