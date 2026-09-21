import { supabase } from "@/integrations/supabase/client";
import { MESSAGES, emergencyContactSchema, firstIssue, normalizeMobile } from "@/lib/validation";

/**
 * One safe way to write the trusted-contact list.
 *
 * The old code deleted every contact and then inserted the new ones as two
 * separate requests — if the insert failed the person was left with no
 * emergency contacts at all, which breaks SOS. The database function does both
 * steps inside a single transaction and validates the payload before deleting,
 * so a failure leaves the existing contacts exactly as they were.
 *
 * Validation here mirrors `public.replace_emergency_contacts` and
 * `public.validate_emergency_contact` exactly — the database is still the
 * authority, this only produces friendlier, earlier errors.
 */
export type ContactInput = {
  name: string;
  relationship: string;
  phone: string;
  email?: string | null;
  is_guardian?: boolean;
};

export const MAX_EMERGENCY_CONTACTS = 10;

export type ContactValidationIssue = { index: number; field: string; message: string };

/** Validates + normalises a contact list without touching the network. */
export function validateContacts(
  contacts: ContactInput[],
  options?: { ownPhone?: string | null },
): { ok: true; contacts: ContactInput[] } | { ok: false; issues: ContactValidationIssue[] } {
  const issues: ContactValidationIssue[] = [];
  const normalised: ContactInput[] = [];
  const seen = new Set<string>();
  const ownPhone = normalizeMobile(options?.ownPhone ?? null);

  if (contacts.length > MAX_EMERGENCY_CONTACTS) {
    issues.push({
      index: -1,
      field: "_",
      message: `At most ${MAX_EMERGENCY_CONTACTS} emergency contacts are allowed.`,
    });
  }

  contacts.forEach((contact, index) => {
    const parsed = emergencyContactSchema.safeParse({
      name: contact.name,
      relationship: contact.relationship,
      phone: contact.phone,
      email: contact.email ?? "",
    });
    if (!parsed.success) {
      for (const issue of parsed.error.issues) {
        issues.push({
          index,
          field: String(issue.path[0] ?? "_"),
          message: issue.message || firstIssue(parsed.error),
        });
      }
      return;
    }
    if (ownPhone && parsed.data.phone === ownPhone) {
      issues.push({
        index,
        field: "phone",
        message: "You cannot add your own number as an emergency contact.",
      });
      return;
    }
    if (seen.has(parsed.data.phone)) {
      issues.push({
        index,
        field: "phone",
        message: "This number is already saved as an emergency contact.",
      });
      return;
    }
    seen.add(parsed.data.phone);
    normalised.push({
      name: parsed.data.name,
      relationship: parsed.data.relationship,
      phone: parsed.data.phone,
      email: parsed.data.email,
      ...(contact.is_guardian === undefined ? {} : { is_guardian: contact.is_guardian }),
    });
  });

  if (issues.length > 0) return { ok: false, issues };
  return { ok: true, contacts: normalised };
}

export async function saveEmergencyContacts(
  userId: string,
  contacts: ContactInput[],
  options?: { ownPhone?: string | null },
) {
  const checked = validateContacts(contacts, options);
  if (!checked.ok) {
    throw new Error(checked.issues[0]?.message ?? MESSAGES.required);
  }

  const payload = checked.contacts.map((contact) => ({
    name: contact.name,
    relationship: contact.relationship,
    phone: contact.phone,
    email: contact.email ?? null,
    ...(contact.is_guardian === undefined ? {} : { is_guardian: contact.is_guardian }),
  }));

  const { error } = await supabase.rpc("replace_emergency_contacts", {
    p_user_id: userId,
    p_contacts: payload,
  });

  if (error) {
    throw new Error(
      error.message === "Unauthorized"
        ? "Unable to save emergency contacts. Your existing contacts were not changed."
        : `${error.message} — your existing contacts were not changed.`,
    );
  }
}
