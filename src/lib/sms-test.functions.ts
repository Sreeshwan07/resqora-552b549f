/**
 * Reports whether the SMS SOS path is actually configured on the server.
 *
 * Only booleans leave the server — no secret value is ever returned, logged or
 * sent to the browser. The check is authenticated so deployment configuration
 * is not disclosed publicly.
 */
import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

export type SmsReadiness = {
  webhookSecret: boolean;
  providerKey: boolean;
  gatewayKey: boolean;
  geocoding: boolean;
};

export const smsReadinessFn = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async (): Promise<SmsReadiness> => {
    const has = (name: string) => Boolean(process.env[name]?.trim());
    return {
      webhookSecret: has("SMS_WEBHOOK_SECRET"),
      providerKey: has("LOVABLE_API_KEY"),
      gatewayKey: has("GATEWAYAPI_API_KEY"),
      geocoding: has("GOOGLE_MAPS_API_KEY"),
    };
  });
