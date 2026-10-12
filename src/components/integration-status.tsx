import { AlertTriangle, CheckCircle2, HeartHandshake, Phone, XCircle } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import type { SmsReadiness } from "@/lib/sms-test.functions";
import { TELE_MANAS, telHref } from "@/lib/helpline";

type State = "configured" | "needs" | "failed";

function Row({ title, state, detail }: { title: string; state: State; detail: string }) {
  const Icon = state === "configured" ? CheckCircle2 : state === "needs" ? AlertTriangle : XCircle;
  const tone =
    state === "configured" ? "text-safe" : state === "needs" ? "text-warning" : "text-alert";
  const label =
    state === "configured" ? "CONFIGURED" : state === "needs" ? "NEEDS CONFIGURATION" : "FAILED";
  return (
    <li className="flex items-start gap-3 text-sm">
      <Icon className={`mt-0.5 size-4 shrink-0 ${tone}`} aria-hidden="true" />
      <div>
        <p className="font-medium text-foreground">
          {title} <span className={`ml-1 text-xs font-semibold ${tone}`}>{label}</span>
        </p>
        <p className="text-xs text-muted-foreground">{detail}</p>
      </div>
    </li>
  );
}

export function IntegrationStatusCard({
  status,
  loading,
}: {
  status: SmsReadiness | undefined;
  loading: boolean;
}) {
  const s = status;
  const smsState: State = !s ? (loading ? "needs" : "failed") : s.twilio ? "configured" : "needs";
  const missing = s
    ? [
        !s.twilioAccountSid && "TWILIO_ACCOUNT_SID",
        !s.twilioAuthToken && "TWILIO_AUTH_TOKEN",
        !s.twilioPhoneNumber && "TWILIO_PHONE_NUMBER",
      ].filter(Boolean)
    : [];
  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-sm">Integration status</CardTitle>
      </CardHeader>
      <CardContent>
        <ul className="space-y-3" aria-live="polite">
          <Row
            title="Text-message SOS"
            state={smsState}
            detail={
              smsState === "configured"
                ? "Twilio configured."
                : s
                  ? `SMS provider is not configured. Missing: ${missing.join(", ")}.`
                  : loading
                    ? "Checking…"
                    : "Could not read server configuration."
            }
          />
          <Row
            title="Emergency email"
            state={s?.emailProvider ? "configured" : "needs"}
            detail={
              s?.emailProvider
                ? "Email provider configured."
                : "Email provider requires a verified sender domain."
            }
          />
          <Row
            title="Mental-health helpline"
            state="configured"
            detail={`${TELE_MANAS.name} ${TELE_MANAS.primary} configured (call only).`}
          />
        </ul>
      </CardContent>
    </Card>
  );
}

export function HelplineCard() {
  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-sm">
          <HeartHandshake className="size-4" aria-hidden="true" />
          Mental-health support — {TELE_MANAS.name}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <p className="text-xs text-muted-foreground">
          Free government helpline. Tapping a button opens your phone's dialer — RESQORA never
          calls automatically and is not directly connected to {TELE_MANAS.name}.
        </p>
        <div className="flex flex-wrap gap-2">
          <Button asChild size="sm">
            <a href={telHref(TELE_MANAS.primary)} aria-label={`Call ${TELE_MANAS.name} ${TELE_MANAS.primary}`}>
              <Phone className="size-4" aria-hidden="true" /> Call {TELE_MANAS.primary}
            </a>
          </Button>
          <Button asChild size="sm" variant="outline">
            <a href={telHref(TELE_MANAS.alternate)} aria-label={`Call ${TELE_MANAS.name} ${TELE_MANAS.alternate}`}>
              <Phone className="size-4" aria-hidden="true" /> Call {TELE_MANAS.alternate}
            </a>
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
