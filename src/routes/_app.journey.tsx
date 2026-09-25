import { createFileRoute } from "@tanstack/react-router";
import { Route as RouteIcon } from "lucide-react";
import { PageHeader } from "@/components/system/page-header";
import { PanelSkeleton } from "@/components/system/loading-skeletons";
import { JourneyStartForm } from "@/components/journey/journey-start-form";
import { ActiveJourneyPanel } from "@/components/journey/active-journey-panel";
import { JourneyHistoryList } from "@/components/journey/journey-history-list";
import { GuardianJourneysCard } from "@/components/journey/guardian-journeys-card";
import { useSafeJourneyMonitor } from "@/hooks/use-safe-journey";

export const Route = createFileRoute("/_app/journey")({
  head: () => ({
    meta: [
      { title: "Safe Journey — RESQORA" },
      {
        name: "description",
        content:
          "Start a RESQORA Safe Journey: share your live location with a trusted guardian, check in on arrival and escalate automatically if no confirmation arrives.",
      },
      { property: "og:title", content: "RESQORA Safe Journey" },
      {
        property: "og:description",
        content:
          "Everyday travel monitoring with guardian check-ins, honest location status and a direct path into the RESQORA emergency session.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: JourneyPage,
});

function JourneyPage() {
  const monitor = useSafeJourneyMonitor();

  return (
    <div className="space-y-6">
      <PageHeader
        icon={RouteIcon}
        title="Safe Journey"
        description="Plan a trip, travel, check in and arrive safely — with a guardian watching only while the journey is active."
      />

      <GuardianJourneysCard />

      {monitor.loading ? (
        <PanelSkeleton />
      ) : monitor.journey ? (
        <ActiveJourneyPanel monitor={monitor} />
      ) : (
        <JourneyStartForm />
      )}

      <section className="space-y-3">
        <h2 className="text-base font-semibold text-foreground">Journey history</h2>
        <JourneyHistoryList />
      </section>

      <p className="text-xs text-muted-foreground">
        Browsers pause location updates for background tabs, so keep RESQORA open while you travel.
        When a journey is closed, RESQORA stops storing your location entirely.
      </p>
    </div>
  );
}
