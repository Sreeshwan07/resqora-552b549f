/**
 * End-to-end SMS SOS test plan.
 *
 * The plan is data, not marketing copy: each step names the exact action, what
 * the database/timeline must show, and what must appear live without a refresh.
 * Nothing here simulates a message — the plan is executed with a real phone
 * once the provider credentials and inbound number are configured.
 */
import { queryOptions } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

export type TestStep = {
  id: string;
  title: string;
  action: string;
  /** Timeline entries that must appear on the incident. */
  timeline: string[];
  /** What must update live, with no page refresh. */
  realtime: string[];
  /** Rows/values to confirm in the app or Command Centre. */
  verify: string[];
};

export const SMS_TEST_STEPS: TestStep[] = [
  {
    id: "prep",
    title: "1 · Preparation",
    action:
      "Sign in on a second device with the account under test. Save the exact phone number of the feature phone in the profile, add at least one emergency contact, and open the Command Centre on a laptop.",
    timeline: [],
    realtime: ["Command Centre incident list is open and idle."],
    verify: [
      "Profile phone number matches the sending SIM exactly (with country code).",
      "At least one emergency contact with a reachable number is saved.",
      "Readiness checks above all show configured.",
    ],
  },
  {
    id: "help",
    title: "2 · Text HELP from the feature phone",
    action:
      "From the feature phone, send: HELP accident near ABC College — to the configured RESQORA number. Do not open the app on that phone.",
    timeline: [
      "Emergency reported by SMS",
      "Location resolved from landmark (only when the landmark could be geocoded)",
      "Emergency contacts notified (only when the provider accepted at least one message)",
    ],
    realtime: [
      "A new incident appears in the Command Centre list within seconds, without refreshing.",
      "The incident carries an SMS badge and a location-source badge.",
    ],
    verify: [
      "Exactly one incident was created (no duplicates).",
      "Type reads as an accident; the written landmark is stored as the address.",
      "Location source reads Provided in the message — never Live GPS.",
      "A reply SMS with the incident reference arrives on the feature phone.",
    ],
  },
  {
    id: "duplicate",
    title: "3 · Provider retry / duplicate protection",
    action:
      "Ask the provider to retry the same message, or send the identical HELP text again within a minute.",
    timeline: ["No second 'Emergency reported by SMS' entry."],
    realtime: ["Command Centre still shows one incident."],
    verify: [
      "No second incident exists for the same sender.",
      "No second reply SMS is sent for the retried message.",
    ],
  },
  {
    id: "volunteers",
    title: "4 · Community matching",
    action:
      "Have a verified volunteer nearby (available, sharing location, position updated in the last 30 minutes) keep the Good Samaritan page open. Then request community assistance for this incident if it was not offered automatically.",
    timeline: [
      "Community assistance requested",
      "Volunteer accepted (after the volunteer accepts)",
    ],
    realtime: [
      "The offer appears on the volunteer's device with no refresh, with an alert toast.",
      "After Accept, the Command Centre dispatch panel shows the volunteer's name, skills and distance live.",
    ],
    verify: [
      "Volunteers with a stale or hidden location are not matched.",
      "Only one volunteer can hold an exclusive request; others see it expire.",
      "The victim's exact identity/contact stays hidden until acceptance.",
    ],
  },
  {
    id: "location",
    title: "5 · Correct the location by SMS",
    action: "From the feature phone, send: LOCATION City Mall, Kukatpally",
    timeline: ["Location updated by SMS"],
    realtime: ["The incident address updates in the Command Centre without refreshing."],
    verify: [
      "Location source still reads Provided in the message.",
      "New coordinates were resolved from the new landmark (or the address changed with no coordinates, stated honestly).",
      "A confirmation SMS arrives.",
    ],
  },
  {
    id: "status",
    title: "6 · Status request",
    action: "From the feature phone, send: STATUS",
    timeline: [],
    realtime: [],
    verify: [
      "The reply contains the real incident reference and the current stage.",
      "The stage in the reply matches the stage shown in the Command Centre.",
    ],
  },
  {
    id: "dispatch",
    title: "7 · Dispatch and hospital handoff",
    action:
      "From the Command Centre, dispatch a unit, move it through Accepted → En route → On scene → Completed, then record a hospital handoff.",
    timeline: ["Resource dispatched", "Assignment status changes", "Hospital handoff recorded"],
    realtime: ["Assignment and responder status update on the incident screen with no refresh."],
    verify: [
      "Responder and hospital status on the incident reflect the real assignment rows.",
      "Every change is timestamped in the timeline.",
    ],
  },
  {
    id: "safe",
    title: "8 · Close by SMS",
    action: "From the feature phone, send: SAFE",
    timeline: ["Closed by SMS", "Resolved"],
    realtime: ["The incident leaves the active list in the Command Centre without refreshing."],
    verify: [
      "The incident is resolved and live tracking links are inactive.",
      "A closing SMS is received.",
      "A later STATUS text reports no active emergency.",
    ],
  },
  {
    id: "debrief",
    title: "9 · Recovery and report",
    action: "Open Recovery for this incident and download the after-action report.",
    timeline: ["Recovery steps recorded as they are completed."],
    realtime: [],
    verify: [
      "Response timings are computed from the real timestamps.",
      "The PDF lists the SMS origin, location provenance, dispatch, volunteers and handoff.",
    ],
  },
];

export const SMS_TEST_FAILURE_CASES = [
  "Unsigned or wrongly signed webhook call is rejected (401) and creates no incident.",
  "A webhook older than the replay window is rejected and creates no incident.",
  "Burst of more than 30 calls a minute from one caller is rate limited (429).",
  "Text from a number not saved in any profile still opens an operator-visible incident, marked as an unknown sender.",
  "When the provider rejects the reply, the delivery is recorded as failed — never as delivered.",
  "Provider or geocoding outage does not lose or alter the incident itself.",
];

export const SMS_TEST_ACCEPTANCE = [
  "One real SMS from a real feature phone opens exactly one real incident.",
  "The incident is visible to operators live, with no manual refresh anywhere.",
  "Location provenance is stated truthfully at every step; no GPS is ever invented.",
  "Volunteer offer, acceptance and expiry are all driven by real database rows.",
  "Every reply SMS status recorded matches what the provider actually reported.",
  "The full lifecycle — report, matching, dispatch, handoff, closure, report — is auditable in the timeline.",
];

/** Incidents that really arrived by SMS for this account, used to verify a run. */
export function smsIncidentsQuery(userId: string | undefined) {
  return queryOptions({
    queryKey: ["sms-incidents", userId],
    enabled: Boolean(userId),
    queryFn: async () => {
      const { data, error } = await supabase
        .from("emergencies")
        .select(
          "id, public_code, type, phase, status, address, location_source, started_at, resolved_at",
        )
        .eq("user_id", userId!)
        .eq("source", "sms")
        .order("started_at", { ascending: false })
        .limit(10);
      if (error) throw new Error(error.message);
      return data ?? [];
    },
  });
}

/** Timeline entries for a chosen SMS incident. */
export function smsIncidentEventsQuery(emergencyId: string | undefined) {
  return queryOptions({
    queryKey: ["sms-incident-events", emergencyId],
    enabled: Boolean(emergencyId),
    queryFn: async () => {
      const { data, error } = await supabase
        .from("emergency_events")
        .select("id, label, detail, created_at")
        .eq("emergency_id", emergencyId!)
        .order("created_at", { ascending: true });
      if (error) throw new Error(error.message);
      return data ?? [];
    },
  });
}
