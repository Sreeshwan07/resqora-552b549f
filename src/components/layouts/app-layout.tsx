import { useEffect, useState, type ReactNode } from "react";
import { motion } from "motion/react";
import { useRouterState } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { AppSidebar } from "@/components/layouts/app-sidebar";
import { AppTopbar } from "@/components/layouts/app-topbar";
import { MobileNav } from "@/components/layouts/mobile-nav";
import { ApprovalGate } from "@/components/system/approval-gate";
import { GlobalSosButton } from "@/components/resqora/global-sos";
import { LiveEmergencyWidget } from "@/components/resqora/live-emergency-widget";
import { LiveLocationCard } from "@/components/resqora/live-location-card";
import { LocationGate } from "@/components/resqora/location-gate";
import { InstallPrompt } from "@/components/pwa/install-prompt";
import { ConnectionBanner } from "@/components/pwa/connection-banner";
import { PushRegistrar } from "@/components/pwa/push-registrar";
import { useLivePosition } from "@/hooks/use-live-position";
import { useEmergencyTracker } from "@/hooks/use-emergency-tracker";
import { useSafeJourneyMonitor } from "@/hooks/use-safe-journey";
import { useRelayEscalation } from "@/hooks/use-relay-escalation";
import { useAuth } from "@/hooks/use-auth";
import { useAccess } from "@/hooks/use-access";
import { useSosTheme } from "@/hooks/use-sos-theme";
import { contactsQuery, profileQuery } from "@/lib/api";
import { isUnrestrictedPath } from "@/lib/access";
import { saveOfflineSnapshot } from "@/lib/offline-cache";
import { ensureNotificationPermission } from "@/lib/emergency-notifications";

export function AppLayout({ children }: { children: ReactNode }) {
  const [collapsed, setCollapsed] = useState(false);
  const { position, address, denied, status, resolvingAddress } = useLivePosition();
  useSosTheme();
  // Live location keeps flowing to the Guardian from every page, not just /live.
  useEmergencyTracker();
  // Escalates to backup contacts when the Guardian does not acknowledge in time.
  useRelayEscalation();
  // Safe Journey monitoring (check-ins, arrival, escalation) runs app-wide.
  useSafeJourneyMonitor();
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const { user } = useAuth();
  const access = useAccess();
  const profile = useQuery(profileQuery(user?.id));
  const contacts = useQuery(contactsQuery(user?.id));
  // Not-yet-approved accounts see the approval notice instead of protected features.
  const locked = !access.loading && !access.approved && !isUnrestrictedPath(pathname);
  // Live location is shown once: on Nearby, where distances depend on it. Home,
  // SOS, Live and Digital Twin each render their own location surface.
  const showLocationCard = pathname === "/nearby" && !locked && access.approved;

  // Ask for notification permission once, then keep an offline copy of the
  // medical ID + trusted contacts so they work with no connectivity.
  useEffect(() => {
    void ensureNotificationPermission();
  }, []);

  useEffect(() => {
    if (!profile.data && !contacts.data) return;
    saveOfflineSnapshot(profile.data, contacts.data ?? []);
  }, [profile.data, contacts.data]);

  return (
    <div className="flex min-h-dvh w-full bg-background aurora">
      <AppSidebar collapsed={collapsed} onToggle={() => setCollapsed((v) => !v)} />
      <div className="flex min-w-0 flex-1 flex-col">
        <ConnectionBanner />
        <AppTopbar />
        <main className="flex-1 px-4 pb-28 pt-6 sm:px-6 lg:pb-10">
          <motion.div
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.35, ease: "easeOut" }}
            className="mx-auto w-full max-w-6xl space-y-8"
          >
            {showLocationCard && (
              <LiveLocationCard
                position={position}
                address={address}
                denied={denied}
                status={status}
                resolvingAddress={resolvingAddress}
              />
            )}
            {locked ? <ApprovalGate status={access.status} /> : children}
          </motion.div>
        </main>
      </div>
      <MobileNav />
      {access.approved && (
        <>
          <LocationGate />
          <GlobalSosButton />
          <LiveEmergencyWidget />
        </>
      )}
      <InstallPrompt />
      <PushRegistrar />
    </div>
  );
}
