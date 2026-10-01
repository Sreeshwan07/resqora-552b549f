/**
 * Emergency email is sent only by the server (see emergency-email.functions.ts).
 * This module keeps the shared, browser-safe helpers.
 */
export const EMAIL_NOT_CONFIGURED = "Email service is not configured.";

export function isValidEmail(value: string | null | undefined) {
  return Boolean(value && /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(value.trim()));
}
