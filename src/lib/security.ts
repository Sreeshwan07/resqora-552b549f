/**
 * RESQORA application security helpers: input sanitisation, validation schemas,
 * client-side abuse throttling and upload validation. Everything here is
 * defence-in-depth on top of database RLS and server-side validation — never a
 * replacement for it.
 */
import { z } from "zod";

/* ------------------------------------------------------------------ */
/* Sanitisation                                                        */
/* ------------------------------------------------------------------ */

// Control characters are matched deliberately so they can be stripped from user input.
// eslint-disable-next-line no-control-regex
const CONTROL_CHARS = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g;

/** Strips tags, control characters and collapses whitespace for single-line text. */
export function sanitizeText(value: string | null | undefined, max = 200) {
  if (!value) return "";
  return value
    .replace(CONTROL_CHARS, "")
    .replace(/<[^>]*>/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, max);
}

/** Same as sanitizeText but keeps intentional line breaks (notes, messages). */
export function sanitizeMultiline(value: string | null | undefined, max = 4000) {
  if (!value) return "";
  return value
    .replace(CONTROL_CHARS, "")
    .replace(/<[^>]*>/g, "")
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim()
    .slice(0, max);
}

/** Keeps only characters that can legally appear in a dialable number. */
export function sanitizePhone(value: string | null | undefined) {
  if (!value) return "";
  return value
    .replace(/[^\d+()\-\s]/g, "")
    .trim()
    .slice(0, 24);
}

/** Only http(s) URLs survive — blocks javascript:, data:, file: and friends. */
export function safeHttpUrl(value: string | null | undefined): string | null {
  if (!value) return null;
  try {
    const url = new URL(value.trim());
    if (url.protocol !== "http:" && url.protocol !== "https:") return null;
    return url.toString();
  } catch {
    return null;
  }
}

/* ------------------------------------------------------------------ */
/* Validation schemas                                                  */
/* ------------------------------------------------------------------ */

/**
 * All field rules now live in a single place (`@/lib/validation`) and are
 * mirrored by database triggers. These re-exports keep existing call sites
 * working while guaranteeing there is only ONE phone/email/name rule.
 */
export {
  emailSchema,
  optionalEmailSchema,
  passwordSchema,
  personNameSchema,
  mobileSchema,
  mobileSchema as phoneSchema,
  emergencyContactSchema as contactSchema,
  firstIssue,
  normalizeMobile,
  normalizeEmail,
  toPhoneDigits,
  MESSAGES as VALIDATION_MESSAGES,
} from "@/lib/validation";

export const noteSchema = z.object({
  title: z
    .string()
    .transform((v) => sanitizeText(v, 120))
    .refine((v) => v.length >= 2, "Enter a title of at least 2 characters"),
  category: z.string().transform((v) => sanitizeText(v, 40)),
  content: z
    .string()
    .transform((v) => sanitizeMultiline(v, 4000))
    .refine((v) => v.length > 0, "Add some content for this note"),
});


/* ------------------------------------------------------------------ */
/* Client-side abuse throttling                                        */
/* ------------------------------------------------------------------ */

export type RateLimitAction =
  "signin" | "signup" | "password-reset" | "sos" | "report" | "share-send";

const LIMITS: Record<RateLimitAction, { max: number; windowMs: number; label: string }> = {
  signin: { max: 6, windowMs: 5 * 60_000, label: "sign-in attempts" },
  signup: { max: 3, windowMs: 15 * 60_000, label: "sign-up attempts" },
  "password-reset": { max: 3, windowMs: 15 * 60_000, label: "password reset requests" },
  sos: { max: 5, windowMs: 60_000, label: "SOS activations" },
  report: { max: 6, windowMs: 5 * 60_000, label: "incident reports" },
  "share-send": { max: 20, windowMs: 5 * 60_000, label: "alert sends" },
};

const KEY = "resqora.rate-limit";

function readBuckets(): Record<string, number[]> {
  if (typeof window === "undefined") return {};
  try {
    return JSON.parse(window.localStorage.getItem(KEY) ?? "{}") as Record<string, number[]>;
  } catch {
    return {};
  }
}

function writeBuckets(buckets: Record<string, number[]>) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(KEY, JSON.stringify(buckets));
  } catch {
    /* storage full or blocked — throttling is best-effort on the client */
  }
}

export type RateLimitResult = { allowed: true } | { allowed: false; message: string };

/**
 * Sliding-window throttle for sensitive actions. Supabase Auth and the database
 * enforce their own limits — this stops accidental and casual abuse from the app
 * before a request is ever made.
 */
export function checkRateLimit(action: RateLimitAction): RateLimitResult {
  const limit = LIMITS[action];
  const now = Date.now();
  const buckets = readBuckets();
  const hits = (buckets[action] ?? []).filter((at) => now - at < limit.windowMs);
  if (hits.length >= limit.max) {
    const retryIn = Math.ceil((limit.windowMs - (now - hits[0])) / 1000);
    const wait = retryIn > 60 ? `${Math.ceil(retryIn / 60)} minute(s)` : `${retryIn} second(s)`;
    buckets[action] = hits;
    writeBuckets(buckets);
    return {
      allowed: false,
      message: `Too many ${limit.label}. Please wait ${wait} and try again.`,
    };
  }
  hits.push(now);
  buckets[action] = hits;
  writeBuckets(buckets);
  return { allowed: true };
}

/** Clears the window after a successful action (e.g. a valid sign-in). */
export function clearRateLimit(action: RateLimitAction) {
  const buckets = readBuckets();
  delete buckets[action];
  writeBuckets(buckets);
}

/* ------------------------------------------------------------------ */
/* Upload validation                                                   */
/* ------------------------------------------------------------------ */

export const ALLOWED_UPLOAD_TYPES = [
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/heic",
  "application/pdf",
] as const;

export const MAX_UPLOAD_BYTES = 8 * 1024 * 1024;

const EXTENSIONS: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "image/heic": "heic",
  "application/pdf": "pdf",
};

/** Cryptographically random object name — never trusts the client filename. */
export function secureObjectName(mimeType: string) {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  const id = Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
  return `${id}.${EXTENSIONS[mimeType] ?? "bin"}`;
}

export function validateUpload(
  file: File,
): { ok: true; name: string } | { ok: false; error: string } {
  if (!(ALLOWED_UPLOAD_TYPES as readonly string[]).includes(file.type)) {
    return { ok: false, error: "Only JPEG, PNG, WebP, HEIC images or PDF files are allowed." };
  }
  if (file.size === 0) return { ok: false, error: "That file appears to be empty." };
  if (file.size > MAX_UPLOAD_BYTES) {
    return { ok: false, error: "Files must be 8 MB or smaller." };
  }
  return { ok: true, name: secureObjectName(file.type) };
}
