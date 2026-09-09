/**
 * Feature-phone SMS SOS — presentation helpers only.
 *
 * The inbound number is configuration, never a hardcoded placeholder: when it
 * is not configured the UI says so instead of showing a number that does not
 * work. All SMS provider credentials stay server-side.
 */
export const SMS_SOS_NUMBER = (import.meta.env["VITE_RESQORA_SMS_NUMBER"] as string | undefined) ?? "";

export const SMS_SOS_CONFIGURED = SMS_SOS_NUMBER.trim().length > 0;

export const SMS_COMMANDS = [
  { command: "HELP", detail: "Opens an emergency for your registered number." },
  { command: "HELP accident near ABC College", detail: "Adds the type and a landmark." },
  { command: "LOCATION City Mall, Kukatpally", detail: "Adds or corrects your landmark." },
  { command: "STATUS", detail: "Replies with your emergency ID and current stage." },
  { command: "SAFE", detail: "Closes your emergency once you are safe." },
] as const;

export const LOCATION_SOURCE_LABELS: Record<string, string> = {
  USER_PROVIDED: "Provided in the message",
  LAST_KNOWN: "Last known RESQORA location",
  DEVICE_GPS: "Live GPS",
  NETWORK: "Provider network location",
  UNAVAILABLE: "Location unavailable",
};

export function locationSourceLabel(source: string | null | undefined) {
  if (!source) return "Location unavailable";
  return LOCATION_SOURCE_LABELS[source] ?? source;
}
