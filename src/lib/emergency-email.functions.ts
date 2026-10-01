import { createServerFn } from "@tanstack/react-start";
import { getRequest } from "@tanstack/react-start/server";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

const input = z.object({
  emergencyId: z.string().uuid(),
  kind: z.enum(["alert", "resolved", "guardian"]).default("alert"),
  contactIds: z.array(z.string().uuid()).max(20).optional(),
  trackingUrl: z.string().max(500).optional(),
});

export type EmergencyEmailResult = {
  configured: boolean;
  skipped: boolean;
  sent: number;
  failed: number;
  duplicate: number;
  error?: string;
  results: { name: string; status: "sent" | "failed" | "duplicate"; error?: string }[];
};

/** "Send emergency alerts for this Emergency Session." — recipients resolved server-side. */
export const requestEmergencyEmails = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => input.parse(d))
  .handler(async ({ data, context }): Promise<EmergencyEmailResult> => {
    const { dispatchEmergencyEmails, safeTrackingUrl } = await import("./emergency-email.server");
    const { isEmailProviderConfigured } = await import("./email-provider.server");
    const { consumeRaw } = await import("./paid-guard.server");
    const limit = await consumeRaw(
      `${context.userId}:${data.emergencyId}`,
      "emergencyEmail",
      600,
      10,
    );
    if (!limit.allowed) {
      return {
        configured: true,
        skipped: false,
        sent: 0,
        failed: 0,
        duplicate: 0,
        error: "Too many email requests for this emergency. Please wait.",
        results: [],
      };
    }
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const origin = new URL(getRequest().url).origin;
    try {
      const r = await dispatchEmergencyEmails({
        userDb: context.supabase,
        adminDb: supabaseAdmin,
        userId: context.userId,
        emergencyId: data.emergencyId,
        kind: data.kind,
        contactIds: data.contactIds,
        trackingUrl: safeTrackingUrl(data.trackingUrl, data.emergencyId, origin),
      });
      const results = r.outcomes.map(({ name, status, error }) => ({ name, status, error }));
      return {
        configured: isEmailProviderConfigured(),
        skipped: r.skipped,
        sent: results.filter((x) => x.status === "sent").length,
        failed: results.filter((x) => x.status === "failed").length,
        duplicate: results.filter((x) => x.status === "duplicate").length,
        results,
      };
    } catch (e) {
      const code = e instanceof Error ? e.message : "";
      const map: Record<string, string> = {
        FORBIDDEN: "Not authorized for this emergency.",
        INVALID_STATE: "This emergency is no longer active.",
        UNAUTHORIZED_RECIPIENT: "That recipient is not one of your emergency contacts.",
      };
      return {
        configured: isEmailProviderConfigured(),
        skipped: false,
        sent: 0,
        failed: 0,
        duplicate: 0,
        error: map[code] ?? "Email notification could not be sent.",
        results: [],
      };
    }
  });

export const emailProviderStatus = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async () => {
    const { isEmailProviderConfigured } = await import("./email-provider.server");
    return { configured: isEmailProviderConfigured() };
  });
