/**
 * Server-only email transport. No provider is connected yet, so every send
 * returns an honest "not configured" failure — nothing is simulated.
 * Connect a provider here (credentials read from process.env inside the call).
 */
export type ProviderResult =
  | { ok: true; providerMessageId: string }
  | { ok: false; category: "not_configured" | "provider_error"; error: string };

export const EMAIL_NOT_CONFIGURED = "Email service is not configured.";

export function isEmailProviderConfigured() {
  return false;
}

export async function sendProviderEmail(_msg: {
  to: string;
  subject: string;
  html: string;
  text: string;
  idempotencyKey: string;
}): Promise<ProviderResult> {
  return { ok: false, category: "not_configured", error: EMAIL_NOT_CONFIGURED };
}
