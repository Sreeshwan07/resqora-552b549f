import { Link } from "@tanstack/react-router";
import { MessageSquare } from "lucide-react";
import { SMS_COMMANDS, SMS_SOS_CONFIGURED, SMS_SOS_NUMBER } from "@/lib/sms-sos";

/**
 * Feature-phone SMS SOS explainer. The number is read from configuration — when
 * none is configured this says so rather than showing a number that would fail.
 */
export function SmsSosInfo() {
  return (
    <div className="glass-panel space-y-3 rounded-2xl p-5">
      <div className="flex items-center gap-2">
        <MessageSquare className="size-4 text-primary" aria-hidden="true" />
        <h2 className="text-sm font-semibold text-foreground">SOS by SMS (no internet needed)</h2>
      </div>
      {SMS_SOS_CONFIGURED ? (
        <p className="text-sm text-muted-foreground">
          From any phone, text <span className="font-semibold text-foreground">HELP</span> to{" "}
          <a href={`sms:${SMS_SOS_NUMBER}?body=HELP`} className="font-semibold text-primary">
            {SMS_SOS_NUMBER}
          </a>
          . Your message must come from the phone number saved in your profile.
        </p>
      ) : (
        <p className="text-sm text-muted-foreground">
          The SMS emergency number is not configured for this deployment yet, so texting is not
          available. Everything else works normally.
        </p>
      )}
      <ul className="space-y-1.5">
        {SMS_COMMANDS.map((item) => (
          <li key={item.command} className="text-xs text-muted-foreground">
            <span className="font-semibold text-foreground">{item.command}</span> — {item.detail}
          </li>
        ))}
      </ul>
      <p className="text-xs text-muted-foreground">
        <Link to="/sms-test" className="font-semibold text-primary">
          Open the SMS test plan
        </Link>{" "}
        to check this path end to end.
      </p>
      <p className="text-xs text-muted-foreground">
        A text message cannot send GPS. RESQORA uses the landmark you type, or your last known
        RESQORA location, and always says which one it used.
      </p>
    </div>
  );
}
