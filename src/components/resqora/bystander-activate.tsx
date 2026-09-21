import { useState } from "react";
import { AlertTriangle, CheckCircle2, Loader2, Siren, UserRoundSearch } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import {
  activateBystanderEmergency,
  bystanderPosition,
  type BystanderResult,
} from "@/lib/bystander";

/**
 * Bystander Mode panel on the public RESQR scan page: raise the emergency for
 * an unconscious victim, with no account and no personal data exposed.
 */
export function BystanderActivate({
  code,
  victimName,
  guardianName,
  hasActiveEmergency,
  onActivated,
}: {
  code: string;
  victimName: string;
  guardianName: string | null;
  hasActiveEmergency: boolean;
  onActivated?: () => void;
}) {
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<BystanderResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  const activate = async () => {
    setBusy(true);
    setError(null);
    try {
      // GPS is best-effort: the emergency is raised either way.
      const position = await bystanderPosition();
      const outcome = await activateBystanderEmergency({ code, note, position });
      setResult(outcome);
      onActivated?.();
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : "Could not raise the emergency. Please call 108 directly.",
      );
    } finally {
      setBusy(false);
    }
  };

  if (result) {
    return (
      <section className="mt-4 rounded-3xl border border-primary/40 bg-primary/5 p-5">
        <p className="flex items-center gap-2 text-sm font-semibold text-primary">
          <CheckCircle2 className="size-4" aria-hidden="true" />
          {result.activation.already_active
            ? "This person already has an active emergency — you have been added to it"
            : "Emergency raised on this person's behalf"}
        </p>
        <p className="mt-2 text-sm text-muted-foreground">
          Reference{" "}
          <span className="font-semibold text-foreground">{result.activation.reference}</span>.
          Their trusted contacts can now see the live emergency.
        </p>
        <p className="mt-2 text-sm text-muted-foreground">
          {result.guardianEmailSent
            ? `Guardian alert emailed to ${result.activation.guardian_name ?? "their guardian"}.`
            : result.activation.guardian_email
              ? "Guardian email could not be confirmed — please call the guardian number above."
              : "No guardian email is on file — please call the guardian number above."}
        </p>
        <div className="mt-4 grid gap-2">
          {result.activation.guardian_phone && (
            <Button asChild size="lg" className="h-14 w-full justify-start rounded-2xl text-base">
              <a href={`tel:${result.activation.guardian_phone.replace(/[^\d+]/g, "")}`}>
                Call {result.activation.guardian_name ?? "guardian"} now
              </a>
            </Button>
          )}
          <Button
            asChild
            size="lg"
            variant="destructive"
            className="h-14 w-full justify-start rounded-2xl text-base"
          >
            <a href="tel:108">
              <Siren className="size-5" aria-hidden="true" />
              Call ambulance (108)
            </a>
          </Button>
        </div>
      </section>
    );
  }

  return (
    <section className="mt-4 rounded-3xl border border-border bg-card p-5 shadow-sm">
      <h2 className="flex items-center gap-2 text-base font-semibold text-foreground">
        <UserRoundSearch className="size-4 text-primary" aria-hidden="true" />
        Found this person in trouble?
      </h2>
      <p className="mt-1 text-sm text-muted-foreground">
        {hasActiveEmergency
          ? `An emergency is already running for ${victimName}. Confirm you are with them so their contacts know help has arrived.`
          : `Raise the emergency for ${victimName}. No account needed — ${guardianName ?? "their guardian"} and their trusted contacts are alerted with your location.`}
      </p>
      <label
        htmlFor="bystander-note"
        className="mt-4 block text-xs font-medium text-muted-foreground"
      >
        What do you see? (optional)
      </label>
      <Textarea
        id="bystander-note"
        value={note}
        maxLength={300}
        onChange={(event) => setNote(event.target.value)}
        placeholder="Road accident near a bus stop, person is conscious but bleeding…"
        className="mt-1 min-h-20 rounded-2xl"
      />
      {error && (
        <p className="mt-3 flex items-start gap-2 text-sm font-medium text-destructive">
          <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
          {error}
        </p>
      )}
      <Button
        size="lg"
        variant="destructive"
        disabled={busy}
        onClick={activate}
        className="mt-4 h-16 w-full justify-start rounded-2xl text-base"
      >
        {busy ? (
          <Loader2 className="size-5 animate-spin" aria-hidden="true" />
        ) : (
          <Siren className="size-5" aria-hidden="true" />
        )}
        {busy
          ? "Raising emergency…"
          : hasActiveEmergency
            ? "I am with them — notify their contacts"
            : "Activate emergency for this person"}
      </Button>
      <p className="mt-3 text-[11px] text-muted-foreground">
        Your approximate location is shared with this person's trusted contacts so they can reach
        you. Nothing else about you is stored.
      </p>
    </section>
  );
}
