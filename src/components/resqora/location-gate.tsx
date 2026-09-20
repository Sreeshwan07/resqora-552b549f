import { useState } from "react";
import { LocateFixed, MapPin, Search, ShieldCheck } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useLivePosition } from "@/hooks/use-live-position";
import { geocodeAddress } from "@/lib/nearby.functions";

/**
 * Blocking-but-escapable location dialog: it only appears when there is no GPS
 * fix and no manual address, and always offers a working manual fallback so the
 * app never dead-ends on a permission error.
 */
export function LocationGate() {
  const { denied, permissionBlocked, position, manual, requestPermission, setManualLocation } =
    useLivePosition();
  const [dismissed, setDismissed] = useState(false);
  const [mode, setMode] = useState<"prompt" | "manual">("prompt");
  const [query, setQuery] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const open = denied && !position && !manual && !dismissed;

  async function enableLocation() {
    setBusy(true);
    setError(null);
    const status = await requestPermission();
    setBusy(false);
    if (status !== "granted") {
      setError(
        "Your browser is still blocking location. Open the padlock (or ⓘ) icon in the address bar → Location → Allow, then reload. On mobile, enable location for your browser in system settings.",
      );
    }
  }

  async function searchAddress(event: React.FormEvent) {
    event.preventDefault();
    if (query.trim().length < 2) return;
    setBusy(true);
    setError(null);
    try {
      const hit = await geocodeAddress({ data: { query: query.trim() } });
      if (!hit) {
        setError("We couldn't find that place. Try adding your city or postcode.");
        return;
      }
      setManualLocation({ lat: hit.lat, lng: hit.lng, label: hit.label });
    } catch {
      setError("Address lookup failed. Check your connection and try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={(value) => !value && setDismissed(true)}>
      <DialogContent className="max-w-md gap-5 rounded-2xl p-5 sm:p-6">
        <DialogHeader>
          <span className="mb-1 grid size-11 place-items-center rounded-xl bg-primary/10 text-primary" aria-hidden="true">
            <MapPin className="size-5" />
          </span>
          <DialogTitle className="text-left text-lg">Location helps emergency services find you</DialogTitle>
          <DialogDescription className="text-left leading-relaxed">
            {permissionBlocked
              ? "RESQORA needs your location to send responders and your trusted contacts an exact position, and to find the nearest hospitals, police, fire stations and blood banks."
              : "GPS isn't available on this device or browser. Enter your address instead so we can still find the nearest emergency services."}
          </DialogDescription>
        </DialogHeader>

        {mode === "manual" ? (
          <form className="grid gap-2 sm:grid-cols-[1fr_auto]" onSubmit={searchAddress}>
            <Input
              autoFocus
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="City, locality or full address"
              aria-label="City, locality or full address"
            />
            <Button type="submit" variant="secondary" disabled={busy} className="h-11 rounded-xl">
              <Search className="size-4" /> {busy ? "Searching…" : "Find"}
            </Button>
          </form>
        ) : null}

        {error && <p role="alert" className="rounded-xl bg-alert/10 p-3 text-xs leading-relaxed text-alert">{error}</p>}

        <p className="flex items-start gap-2 text-xs leading-relaxed text-muted-foreground">
          <ShieldCheck className="mt-0.5 size-4 shrink-0 text-success" aria-hidden="true" />
          Your location is used for emergency response and nearby-service results.
        </p>

        <DialogFooter className="flex-col gap-2 sm:flex-row">
          <Button
            className="h-11 w-full rounded-xl sm:flex-1"
            onClick={() => void enableLocation()}
            disabled={busy}
          >
            <LocateFixed className="size-4" /> Enable location
          </Button>
          {mode === "prompt" && (
            <Button
              variant="outline"
              className="h-11 w-full rounded-xl sm:flex-1"
              onClick={() => setMode("manual")}
            >
              <Search className="size-4" /> Enter address manually
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
