import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Loader2, MapPin, Search, ShieldCheck } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { FieldError } from "@/components/system/validated-field";
import { useAuth } from "@/hooks/use-auth";
import { useLivePosition } from "@/hooks/use-live-position";
import { contactsQuery, profileQuery } from "@/lib/api";
import { searchPlaces, type PlaceMatch } from "@/lib/geocode";
import { safetyCircleQuery } from "@/lib/safe-journey";
import {
  CHECK_IN_INTERVAL_OPTIONS,
  GRACE_PERIOD_OPTIONS,
  notifyJourneyEvent,
  startJourney,
  trackJourneyEvent,
} from "@/lib/safe-journey";

function defaultArrival() {
  const at = new Date(Date.now() + 45 * 60_000);
  at.setSeconds(0, 0);
  // datetime-local expects local time without a timezone suffix.
  const offset = at.getTimezoneOffset() * 60_000;
  return new Date(at.getTime() - offset).toISOString().slice(0, 16);
}

export function JourneyStartForm({ onStarted }: { onStarted?: () => void }) {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const contacts = useQuery(contactsQuery(user?.id));
  const profile = useQuery(profileQuery(user?.id));
  const circle = useQuery(safetyCircleQuery(user?.id));
  const { position, address } = useLivePosition();

  const [name, setName] = useState("");
  const [originAddress, setOriginAddress] = useState("");
  const [useCurrentOrigin, setUseCurrentOrigin] = useState(true);
  const [destinationQuery, setDestinationQuery] = useState("");
  const [destination, setDestination] = useState<PlaceMatch | null>(null);
  const [matches, setMatches] = useState<PlaceMatch[]>([]);
  const [searching, setSearching] = useState(false);
  const [searched, setSearched] = useState(false);
  const [guardianId, setGuardianId] = useState("");
  const [arrival, setArrival] = useState(defaultArrival);
  const [interval, setIntervalValue] = useState<string>("");
  const [grace, setGrace] = useState("10");
  const [sharing, setSharing] = useState(true);
  const [notifyStart, setNotifyStart] = useState(true);
  const [notifyComplete, setNotifyComplete] = useState(true);
  const [notifyMissed, setNotifyMissed] = useState(true);
  const [errors, setErrors] = useState<Record<string, string>>({});

  const defaultGuardian = useMemo(
    () => circle.data?.find((member) => member.is_default_guardian)?.contact_id ?? "",
    [circle.data],
  );

  useEffect(() => {
    if (!guardianId && defaultGuardian) setGuardianId(defaultGuardian);
  }, [defaultGuardian, guardianId]);

  useEffect(() => {
    if (useCurrentOrigin && address) setOriginAddress(address);
  }, [useCurrentOrigin, address]);

  const search = async () => {
    if (destinationQuery.trim().length < 3) {
      setErrors((prev) => ({ ...prev, destination: "Enter at least 3 characters to search." }));
      return;
    }
    setSearching(true);
    setSearched(false);
    const results = await searchPlaces(destinationQuery);
    setMatches(results);
    setSearching(false);
    setSearched(true);
    setErrors((prev) => ({ ...prev, destination: "" }));
  };

  const start = useMutation({
    mutationFn: async () => {
      const next: Record<string, string> = {};
      if (name.trim().length < 2) next.name = "Give this journey a short name.";
      if (!guardianId) next.guardian = "Choose one of your emergency contacts.";
      if (!destination) next.destination = "Search and select your destination.";
      const arrivalDate = new Date(arrival);
      if (Number.isNaN(arrivalDate.getTime()) || arrivalDate.getTime() <= Date.now()) {
        next.arrival = "Expected arrival must be in the future.";
      }
      setErrors(next);
      if (Object.keys(next).length > 0) throw new Error("Please fix the highlighted fields.");

      const journey = await startJourney({
        name: name.trim(),
        guardianContactId: guardianId,
        originAddress: (useCurrentOrigin ? address : originAddress) || null,
        originLatitude: useCurrentOrigin ? (position?.lat ?? null) : null,
        originLongitude: useCurrentOrigin ? (position?.lng ?? null) : null,
        destinationAddress: destination!.address,
        destinationLatitude: destination!.latitude,
        destinationLongitude: destination!.longitude,
        expectedArrivalAt: arrivalDate.toISOString(),
        checkInIntervalMinutes: interval ? Number(interval) : null,
        gracePeriodMinutes: Number(grace),
        sharingEnabled: sharing,
        notifyOnStart: notifyStart,
        notifyOnComplete: notifyComplete,
        notifyOnMissed: notifyMissed,
      });

      const outcomes = await notifyJourneyEvent({
        journey,
        event: "JOURNEY_STARTED",
        profile: profile.data,
        guardian: notifyStart,
      });
      trackJourneyEvent(user?.id, "journey_started");
      return { journey, outcomes };
    },
    onSuccess: async ({ outcomes }) => {
      await queryClient.invalidateQueries({ queryKey: ["safe-journey-active", user?.id] });
      await queryClient.invalidateQueries({ queryKey: ["safe-journey-history", user?.id] });
      const email = outcomes.find((o) => o.channel === "email");
      toast.success(
        email?.status === "sent"
          ? "Safe Journey started — your guardian has been emailed."
          : "Safe Journey started.",
      );
      if (email && email.status !== "sent") toast.warning(email.detail);
      onStarted?.();
    },
    onError: (error: Error) => toast.error(error.message),
  });

  const contactOptions = contacts.data ?? [];

  return (
    <form
      className="space-y-5 rounded-2xl border border-border bg-card p-4 sm:p-6"
      onSubmit={(event) => {
        event.preventDefault();
        start.mutate();
      }}
    >
      <div>
        <h2 className="text-lg font-semibold text-foreground">Start a Safe Journey</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Location sharing is active only while this journey is active.
        </p>
      </div>

      <div className="space-y-2">
        <Label htmlFor="journey-name">Journey name</Label>
        <Input
          id="journey-name"
          value={name}
          maxLength={80}
          placeholder="Home → College"
          onChange={(event) => setName(event.target.value)}
          aria-invalid={Boolean(errors.name)}
        />
        <FieldError id="journey-name-error" message={errors.name} />
      </div>

      <div className="space-y-2">
        <div className="flex items-center justify-between gap-3">
          <Label htmlFor="journey-origin">Starting location</Label>
          <label className="flex items-center gap-2 text-xs text-muted-foreground">
            <Switch
              checked={useCurrentOrigin}
              onCheckedChange={setUseCurrentOrigin}
              aria-label="Use my current location as the starting point"
            />
            Use current location
          </label>
        </div>
        <Input
          id="journey-origin"
          value={useCurrentOrigin ? (address ?? "Getting your location…") : originAddress}
          readOnly={useCurrentOrigin}
          placeholder="Where are you starting from?"
          onChange={(event) => setOriginAddress(event.target.value)}
        />
      </div>

      <div className="space-y-2">
        <Label htmlFor="journey-destination">Destination</Label>
        <div className="flex gap-2">
          <Input
            id="journey-destination"
            value={destinationQuery}
            placeholder="Search a place or address"
            onChange={(event) => {
              setDestinationQuery(event.target.value);
              setDestination(null);
            }}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.preventDefault();
                void search();
              }
            }}
            aria-invalid={Boolean(errors.destination)}
          />
          <Button
            type="button"
            variant="outline"
            className="min-h-11 shrink-0"
            onClick={() => void search()}
            disabled={searching}
          >
            {searching ? (
              <Loader2 className="size-4 animate-spin" aria-hidden="true" />
            ) : (
              <Search className="size-4" aria-hidden="true" />
            )}
            <span className="sr-only sm:not-sr-only">Search</span>
          </Button>
        </div>
        {destination && (
          <p className="flex items-start gap-2 rounded-xl border border-success/40 bg-success/10 p-3 text-sm text-foreground">
            <MapPin className="mt-0.5 size-4 shrink-0 text-success" aria-hidden="true" />
            {destination.address}
          </p>
        )}
        {!destination && matches.length > 0 && (
          <ul className="divide-y divide-border overflow-hidden rounded-xl border border-border">
            {matches.map((match) => (
              <li key={`${match.latitude},${match.longitude}`}>
                <button
                  type="button"
                  className="w-full px-3 py-3 text-left text-sm hover:bg-accent"
                  onClick={() => {
                    setDestination(match);
                    setMatches([]);
                  }}
                >
                  {match.address}
                </button>
              </li>
            ))}
          </ul>
        )}
        {!destination && searched && matches.length === 0 && (
          <p className="text-sm text-muted-foreground">
            No place matched that search. Try a more specific address.
          </p>
        )}
        <FieldError id="journey-destination-error" message={errors.destination} />
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-2">
          <Label htmlFor="journey-arrival">Expected arrival</Label>
          <Input
            id="journey-arrival"
            type="datetime-local"
            value={arrival}
            onChange={(event) => setArrival(event.target.value)}
            aria-invalid={Boolean(errors.arrival)}
          />
          <FieldError id="journey-arrival-error" message={errors.arrival} />
        </div>

        <div className="space-y-2">
          <Label htmlFor="journey-guardian">Guardian</Label>
          <Select value={guardianId} onValueChange={setGuardianId}>
            <SelectTrigger id="journey-guardian" aria-invalid={Boolean(errors.guardian)}>
              <SelectValue
                placeholder={
                  contactOptions.length === 0 ? "Add an emergency contact first" : "Choose a contact"
                }
              />
            </SelectTrigger>
            <SelectContent>
              {contactOptions.map((contact) => (
                <SelectItem key={contact.id} value={contact.id}>
                  {contact.name} · {contact.relationship}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <FieldError id="journey-guardian-error" message={errors.guardian} />
        </div>

        <div className="space-y-2">
          <Label htmlFor="journey-interval">Check-ins</Label>
          <Select value={interval} onValueChange={setIntervalValue}>
            <SelectTrigger id="journey-interval">
              <SelectValue placeholder="Arrival confirmation only" />
            </SelectTrigger>
            <SelectContent>
              {CHECK_IN_INTERVAL_OPTIONS.filter((option) => option.value).map((option) => (
                <SelectItem key={option.value} value={option.value}>
                  {option.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="space-y-2">
          <Label htmlFor="journey-grace">Escalation grace period</Label>
          <Select value={grace} onValueChange={setGrace}>
            <SelectTrigger id="journey-grace">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {GRACE_PERIOD_OPTIONS.map((minutes) => (
                <SelectItem key={minutes} value={String(minutes)}>
                  {minutes} minutes
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      <fieldset className="space-y-3 rounded-xl border border-border p-4">
        <legend className="px-1 text-sm font-medium text-foreground">Privacy & guardian</legend>
        {[
          {
            id: "sharing",
            label: "Share my live location during this journey",
            value: sharing,
            set: setSharing,
          },
          {
            id: "start",
            label: "Tell my guardian when the journey starts",
            value: notifyStart,
            set: setNotifyStart,
          },
          {
            id: "complete",
            label: "Tell my guardian when I arrive safely",
            value: notifyComplete,
            set: setNotifyComplete,
          },
          {
            id: "missed",
            label: "Alert my guardian if I miss a check-in",
            value: notifyMissed,
            set: setNotifyMissed,
          },
        ].map((row) => (
          <label key={row.id} className="flex items-center justify-between gap-4 text-sm">
            <span className="text-muted-foreground">{row.label}</span>
            <Switch checked={row.value} onCheckedChange={row.set} aria-label={row.label} />
          </label>
        ))}
      </fieldset>

      <Button type="submit" size="xl" className="min-h-12 w-full" disabled={start.isPending}>
        {start.isPending ? (
          <Loader2 className="size-5 animate-spin" aria-hidden="true" />
        ) : (
          <ShieldCheck className="size-5" aria-hidden="true" />
        )}
        Start Safe Journey
      </Button>
    </form>
  );
}
