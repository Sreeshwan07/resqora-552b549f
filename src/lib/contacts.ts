import { supabase } from "@/integrations/supabase/client";

/**
 * One safe way to write the trusted-contact list.
 *
 * The old code deleted every contact and then inserted the new ones as two
 * separate requests — if the insert failed the person was left with no
 * emergency contacts at all, which breaks SOS. The database function does both
 * steps inside a single transaction and validates the payload before deleting,
 * so a failure leaves the existing contacts exactly as they were.
 */
export type ContactInput = {
  name: string;
  relationship: string;
  phone: string;
  email?: string | null;
  is_guardian?: boolean;
};

export const MAX_EMERGENCY_CONTACTS = 10;

export async function saveEmergencyContacts(userId: string, contacts: ContactInput[]) {
  const payload = contacts.map((contact) => ({
    name: contact.name.trim(),
    relationship: contact.relationship.trim(),
    phone: contact.phone.trim(),
    email: contact.email?.trim() || null,
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
