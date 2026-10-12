/**
 * Reports whether integrations are actually configured on the server.
 *
 * Only booleans leave the server — no secret value is ever returned, logged or
 * sent to the browser. Authenticated so deployment configuration is not public.
 */
import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

export type SmsReadiness = {
  webhookSecret: boolean;
  providerKey: boolean;
  gatewayKey: boolean;
  geocoding: boolean;
  twilio: boolean;
  twilioAccountSid: boolean;
  twilioAuthToken: boolean;
  twilioPhoneNumber: boolean;
  emailProvider: boolean;
  emailFrom: boolean;
};

export const smsReadinessFn = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async (): Promise<SmsReadiness> => {
    const has = (name: string) => Boolean(process.env[name]?.trim());
    const sid = has("TWILIO_ACCOUNT_SID");
    const token = has("TWILIO_AUTH_TOKEN");
    const num = has("TWILIO_PHONE_NUMBER");
    return {
      webhookSecret: has("SMS_WEBHOOK_SECRET"),
      providerKey: has("LOVABLE_API_KEY"),
      gatewayKey: has("GATEWAYAPI_API_KEY"),
      geocoding: has("GOOGLE_MAPS_API_KEY"),
      twilio: sid && token && num,
      twilioAccountSid: sid,
      twilioAuthToken: token,
      twilioPhoneNumber: num,
      // The email transport has no connected provider yet (see email-provider.server.ts).
      emailProvider: false,
      emailFrom: has("EMERGENCY_FROM_EMAIL"),
    };
  });
