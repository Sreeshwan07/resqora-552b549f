/**
 * RESQORA — single source of truth for user-input validation.
 *
 * Every form in the app validates through the schemas in this file, and the
 * database enforces the identical rules again in BEFORE INSERT/UPDATE triggers
 * (`validate_profile_input`, `validate_emergency_contact`,
 * `validate_volunteer_input`, `validate_blood_donor`,
 * `validate_responder_input`, `replace_emergency_contacts`). The client copy
 * exists for instant, field-level feedback only — it is never the gatekeeper.
 *
 * Never add a second phone/email/name regex elsewhere: import from here.
 */
import { z } from "zod";

/* ------------------------------------------------------------------ */
/* Messages — reused verbatim in the UI and mirrored in the database   */
/* ------------------------------------------------------------------ */

export const MESSAGES = {
  required: "This field is required.",
  phone: "Enter a valid 10-digit Indian mobile number.",
  email: "Enter a valid email address.",
  name: "Enter a valid name.",
  relationship: "Enter a valid relationship.",
  city: "Enter a valid city.",
  address: "Enter a real address (at least 5 characters).",
  placeholder: "Enter a real value, not a placeholder.",
  dob: "Enter a valid date of birth.",
  dobFuture: "Date of birth cannot be in the future.",
  password: "Password must be at least 8 characters.",
  skills: "Choose at least one skill you can offer.",
} as const;

/* ------------------------------------------------------------------ */
/* Phone — exactly 10 digits, Indian mobile series                     */
/* ------------------------------------------------------------------ */

export const INDIAN_MOBILE_RE = /^[6-9][0-9]{9}$/;
export const PHONE_MAX_LENGTH = 10;
export const PHONE_DIAL_PREFIX = "+91";

/**
 * Turns anything a keyboard or clipboard can produce into at most 10 digits.
 * Country/trunk prefixes (+91, 0091, 0) are dropped so pasting a full
 * international number still yields the stored 10-digit form.
 */
export function toPhoneDigits(raw: string | null | undefined): string {
  let digits = (raw ?? "").replace(/\D/g, "");
  if (digits.length > PHONE_MAX_LENGTH) {
    digits = digits.slice(-PHONE_MAX_LENGTH);
  }
  return digits;
}

/** Normalised 10-digit number, or null when the input is not a valid mobile. */
export function normalizeMobile(raw: string | null | undefined): string | null {
  const digits = toPhoneDigits(raw);
  return INDIAN_MOBILE_RE.test(digits) ? digits : null;
}

export function isValidMobile(raw: string | null | undefined): boolean {
  return normalizeMobile(raw) !== null;
}

/** Display helper — never stored, keeps +91 separate from the stored digits. */
export function formatMobile(raw: string | null | undefined): string {
  const digits = toPhoneDigits(raw);
  return digits ? `${PHONE_DIAL_PREFIX} ${digits}` : "";
}

/** Dialable href for tel: links. */
export function dialHref(raw: string | null | undefined): string {
  const digits = toPhoneDigits(raw);
  return digits.length === PHONE_MAX_LENGTH ? `tel:${PHONE_DIAL_PREFIX}${digits}` : `tel:${digits}`;
}

export const mobileSchema = z
  .string({ message: MESSAGES.required })
  .transform((value) => toPhoneDigits(value))
  .refine((value) => INDIAN_MOBILE_RE.test(value), MESSAGES.phone);

/** Optional variant: empty is allowed, anything present must be a valid mobile. */
export const optionalMobileSchema = z
  .string()
  .optional()
  .nullable()
  .transform((value) => toPhoneDigits(value ?? ""))
  .refine((value) => value === "" || INDIAN_MOBILE_RE.test(value), MESSAGES.phone)
  .transform((value) => (value === "" ? null : value));

/* ------------------------------------------------------------------ */
/* Email                                                               */
/* ------------------------------------------------------------------ */

// Local part: no spaces, no leading/trailing/double dots. Domain: labelled,
// with a real TLD of at least two letters. Mirrors `public.normalise_email`.
export const EMAIL_RE =
  /^[A-Za-z0-9!#$%&'*+/=?^_`{|}~-]+(?:\.[A-Za-z0-9!#$%&'*+/=?^_`{|}~-]+)*@[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?(?:\.[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?)*\.[A-Za-z]{2,}$/;

export function normalizeEmail(raw: string | null | undefined): string | null {
  const value = (raw ?? "").trim().toLowerCase();
  if (!value || value.length > 255) return null;
  if (value.includes("..")) return null;
  return EMAIL_RE.test(value) ? value : null;
}

export function isValidEmail(raw: string | null | undefined): boolean {
  return normalizeEmail(raw) !== null;
}

export const emailSchema = z
  .string({ message: MESSAGES.required })
  .transform((value) => value.trim().toLowerCase())
  .refine((value) => value.length > 0, MESSAGES.required)
  .refine((value) => normalizeEmail(value) !== null, MESSAGES.email);

export const optionalEmailSchema = z
  .string()
  .optional()
  .nullable()
  .transform((value) => (value ?? "").trim().toLowerCase())
  .refine((value) => value === "" || normalizeEmail(value) !== null, MESSAGES.email)
  .transform((value) => (value === "" ? null : value));

/* ------------------------------------------------------------------ */
/* Names & short text                                                  */
/* ------------------------------------------------------------------ */

// Letters, spaces, apostrophes, hyphens and full stops only — no digits.
export const PERSON_NAME_RE = /^[A-Za-z][A-Za-z'.\- ]{1,79}$/;

export function normalizeName(raw: string | null | undefined): string {
  return (raw ?? "").replace(/\s+/g, " ").trim();
}

export function isValidName(raw: string | null | undefined): boolean {
  return PERSON_NAME_RE.test(normalizeName(raw));
}

export const personNameSchema = z
  .string({ message: MESSAGES.required })
  .transform((value) => normalizeName(value))
  .refine((value) => value.length > 0, MESSAGES.required)
  .refine((value) => PERSON_NAME_RE.test(value), MESSAGES.name);

export const relationshipSchema = z
  .string({ message: MESSAGES.required })
  .transform((value) => normalizeName(value))
  .refine((value) => value.length > 0, MESSAGES.required)
  .refine((value) => value.length >= 2 && value.length <= 60, MESSAGES.relationship);

export const passwordSchema = z
  .string({ message: MESSAGES.required })
  .min(8, MESSAGES.password)
  .max(128, "Password must be shorter than 128 characters.");

/** Required free text with a sensible minimum, e.g. note titles. */
export function requiredTextSchema(min = 2, max = 200, message = MESSAGES.required) {
  return z
    .string({ message: MESSAGES.required })
    .transform((value) => value.replace(/\s+/g, " ").trim())
    .refine((value) => value.length >= min && value.length <= max, message);
}

/* ------------------------------------------------------------------ */
/* Address / city                                                      */
/* ------------------------------------------------------------------ */

const PLACEHOLDERS = new Set([
  "test",
  "testing",
  "abc",
  "abcd",
  "asdf",
  "asdfgh",
  "qwerty",
  "xyz",
  "na",
  "n/a",
  "none",
  "nil",
  "null",
  "unknown",
  "no",
  "-",
  "--",
  ".",
  "123",
  "1234",
  "0",
  "sample",
  "dummy",
  "placeholder",
]);

export function isPlaceholderValue(raw: string | null | undefined): boolean {
  const value = (raw ?? "").trim().toLowerCase();
  if (!value) return false;
  if (PLACEHOLDERS.has(value)) return true;
  // Only digits or only punctuation is never a real place name.
  if (/^[^A-Za-z]+$/.test(value)) return true;
  return false;
}

export const citySchema = z
  .string({ message: MESSAGES.required })
  .transform((value) => value.replace(/\s+/g, " ").trim())
  .refine((value) => value.length > 0, MESSAGES.required)
  .refine((value) => value.length >= 2 && value.length <= 120, MESSAGES.city)
  .refine((value) => /[A-Za-z]{2}/.test(value), MESSAGES.city)
  .refine((value) => !isPlaceholderValue(value), MESSAGES.placeholder);

export const addressSchema = z
  .string({ message: MESSAGES.required })
  .transform((value) => value.replace(/[ \t]+/g, " ").trim())
  .refine((value) => value.length >= 5 && value.length <= 300, MESSAGES.address)
  .refine((value) => /[A-Za-z]{2}/.test(value), MESSAGES.address)
  .refine((value) => !isPlaceholderValue(value), MESSAGES.placeholder);

export const optionalAddressSchema = z
  .string()
  .optional()
  .nullable()
  .transform((value) => (value ?? "").replace(/[ \t]+/g, " ").trim())
  .refine((value) => value === "" || value.length >= 5, MESSAGES.address)
  .refine((value) => value === "" || !isPlaceholderValue(value), MESSAGES.placeholder)
  .transform((value) => (value === "" ? null : value));

export const optionalCitySchema = z
  .string()
  .optional()
  .nullable()
  .transform((value) => (value ?? "").replace(/\s+/g, " ").trim())
  .refine((value) => value === "" || /[A-Za-z]{2}/.test(value), MESSAGES.city)
  .refine((value) => value === "" || !isPlaceholderValue(value), MESSAGES.placeholder)
  .transform((value) => (value === "" ? null : value));

/* ------------------------------------------------------------------ */
/* Dates                                                               */
/* ------------------------------------------------------------------ */

const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/** True when the string is a real calendar date (rejects 2026-02-31 etc.). */
export function isRealDate(value: string): boolean {
  if (!ISO_DATE_RE.test(value)) return false;
  const [y, m, d] = value.split("-").map(Number);
  const date = new Date(Date.UTC(y, m - 1, d));
  return date.getUTCFullYear() === y && date.getUTCMonth() === m - 1 && date.getUTCDate() === d;
}

export function ageFromDob(value: string | null | undefined): number | null {
  if (!value || !isRealDate(value)) return null;
  const dob = new Date(`${value}T00:00:00Z`);
  const now = new Date();
  let age = now.getUTCFullYear() - dob.getUTCFullYear();
  const monthDiff = now.getUTCMonth() - dob.getUTCMonth();
  if (monthDiff < 0 || (monthDiff === 0 && now.getUTCDate() < dob.getUTCDate())) age -= 1;
  return age;
}

/** Today in the browser's local calendar — used as the date input max. */
export function todayIso(): string {
  const now = new Date();
  const month = `${now.getMonth() + 1}`.padStart(2, "0");
  const day = `${now.getDate()}`.padStart(2, "0");
  return `${now.getFullYear()}-${month}-${day}`;
}

export const optionalDobSchema = z
  .string()
  .optional()
  .nullable()
  .transform((value) => (value ?? "").trim())
  .refine((value) => value === "" || isRealDate(value), MESSAGES.dob)
  .refine((value) => value === "" || value <= todayIso(), MESSAGES.dobFuture)
  .refine((value) => {
    if (value === "") return true;
    const age = ageFromDob(value);
    return age !== null && age <= 120;
  }, MESSAGES.dob)
  .transform((value) => (value === "" ? null : value));

/* ------------------------------------------------------------------ */
/* Composite records                                                   */
/* ------------------------------------------------------------------ */

export const emergencyContactSchema = z.object({
  name: personNameSchema,
  relationship: relationshipSchema,
  phone: mobileSchema,
  email: optionalEmailSchema,
});

export type ValidatedContact = z.output<typeof emergencyContactSchema>;

export const profileDetailsSchema = z.object({
  full_name: personNameSchema,
  phone: mobileSchema,
  date_of_birth: optionalDobSchema,
  current_city: citySchema,
  home_address: optionalAddressSchema,
});

export const volunteerSignupSchema = z.object({
  fullName: personNameSchema,
  phone: mobileSchema,
  skills: z.array(z.string()).min(1, MESSAGES.skills),
  radiusKm: z
    .number()
    .min(1, "Travel distance must be 1-50 km.")
    .max(50, "Travel distance must be 1-50 km."),
});

export const donorListingSchema = z.object({
  blood_group: z.string().min(1, "Choose a valid blood group."),
  city: citySchema,
  phone: mobileSchema,
});

export const responderProfileSchema = z.object({
  full_name: personNameSchema,
  phone: optionalMobileSchema,
});

/* ------------------------------------------------------------------ */
/* Helpers for field-level UI errors                                   */
/* ------------------------------------------------------------------ */

/** First human-readable problem for one value, or null when it is fine. */
export function fieldError(
  schema: z.ZodType,
  value: unknown,
  options?: { touched?: boolean },
): string | null {
  if (options && options.touched === false) return null;
  const result = schema.safeParse(value);
  if (result.success) return null;
  return result.error.issues[0]?.message ?? MESSAGES.required;
}

/** First issue message from a Zod error (used for whole-form submits). */
export function firstIssue(error: z.ZodError): string {
  return error.issues[0]?.message ?? "Please check the details you entered.";
}

/** All field errors of an object schema, keyed by field name. */
export function collectErrors<T extends z.ZodType>(
  schema: T,
  value: unknown,
): Record<string, string> {
  const result = schema.safeParse(value);
  if (result.success) return {};
  const out: Record<string, string> = {};
  for (const issue of result.error.issues) {
    const key = issue.path.join(".") || "_";
    if (!out[key]) out[key] = issue.message;
  }
  return out;
}
