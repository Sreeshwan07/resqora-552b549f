import { useEffect, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Copy, Loader2, PhoneCall, Save, ShieldCheck, ShieldOff, UserRound } from "lucide-react";
import { Link } from "@tanstack/react-router";
import { toast } from "sonner";
import { PageHeader } from "@/components/system/page-header";
import { MedicalIdCard } from "@/components/resqora/medical-id-card";
import { GuardianCard } from "@/components/resqora/guardian-card";
import { SafetyScoreCard } from "@/components/resqora/safety-score-card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useAuth } from "@/hooks/use-auth";
import { useAccess } from "@/hooks/use-access";
import { supabase } from "@/integrations/supabase/client";
import { computeSafetyScore, contactsQuery, profileQuery } from "@/lib/api";
import { copyText } from "@/lib/alerts";
import { ensureMedicalShareLink, revokeShareLink, shareUrl } from "@/lib/share";
import { logSecurityEvent } from "@/lib/audit";
import { saveEmergencyContacts } from "@/lib/contacts";
import {
  contactSchema,
  firstIssue,
  sanitizeMultiline,
  sanitizePhone,
  sanitizeText,
} from "@/lib/security";
import { logActivity } from "@/lib/activity";

export const Route = createFileRoute("/_app/profile")({
  head: () => ({
    meta: [
      { title: "Your profile & medical ID — RESQORA" },
      {
        name: "description",
        content:
          "Manage your RESQORA personal details, medical ID and the three trusted contacts we alert in an emergency.",
      },
      { property: "og:title", content: "RESQORA Profile & Medical ID" },
      { property: "og:description", content: "Personal details, medical ID and trusted contacts." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: ProfilePage,
});

type ContactDraft = {
  id?: string;
  name: string;
  relationship: string;
  phone: string;
  email: string;
};

function ProfilePage() {
  const { user } = useAuth();
  const access = useAccess();
  const queryClient = useQueryClient();
  const profile = useQuery(profileQuery(user?.id));
  const contacts = useQuery(contactsQuery(user?.id));
  const [saving, setSaving] = useState(false);

  const [form, setForm] = useState({
    full_name: "",
    phone: "",
    date_of_birth: "",
    gender: "",
    current_city: "",
    home_address: "",
    blood_group: "",
    allergies: "",
    medical_conditions: "",
    medications: "",
    preferred_hospital: "",
    language: "en",
  });
  const [drafts, setDrafts] = useState<ContactDraft[]>([]);

  useEffect(() => {
    if (!profile.data) return;
    setForm({
      full_name: profile.data.full_name ?? "",
      phone: profile.data.phone ?? "",
      date_of_birth: profile.data.date_of_birth ?? "",
      gender: profile.data.gender ?? "",
      current_city: profile.data.current_city ?? "",
      home_address: profile.data.home_address ?? "",
      blood_group: profile.data.blood_group ?? "",
      allergies: profile.data.allergies ?? "",
      medical_conditions: profile.data.medical_conditions ?? "",
      medications: profile.data.medications ?? "",
      preferred_hospital: profile.data.preferred_hospital ?? "",
      language: profile.data.language ?? "en",
    });
  }, [profile.data]);

  useEffect(() => {
    const base: ContactDraft[] = (contacts.data ?? []).map((c) => ({
      id: c.id,
      name: c.name,
      relationship: c.relationship,
      phone: c.phone,
      email: c.email ?? "",
    }));
    while (base.length < 3) base.push({ name: "", relationship: "", phone: "", email: "" });
    setDrafts(base.slice(0, 3));
  }, [contacts.data]);

  const score = computeSafetyScore(
    { ...(profile.data ?? {}), ...form } as never,
    (contacts.data ?? []) as never,
  );

  async function saveProfile() {
    if (!user) return;
    setSaving(true);
    const { error } = await supabase
      .from("profiles")
      .update({
        full_name: sanitizeText(form.full_name, 120) || null,
        phone: sanitizePhone(form.phone) || null,
        date_of_birth: form.date_of_birth || null,
        gender: sanitizeText(form.gender, 40) || null,
        current_city: sanitizeText(form.current_city, 120) || null,
        home_address: sanitizeText(form.home_address, 300) || null,
        blood_group: sanitizeText(form.blood_group, 8) || null,
        allergies: sanitizeMultiline(form.allergies, 1000) || null,
        medical_conditions: sanitizeMultiline(form.medical_conditions, 1000) || null,
        medications: sanitizeMultiline(form.medications, 1000) || null,
        preferred_hospital: sanitizeText(form.preferred_hospital, 160) || null,
        language: sanitizeText(form.language, 20) || "en",
        safety_score: score,
      })
      .eq("id", user.id);
    setSaving(false);
    if (error) {
      toast.error(error.message);
      return;
    }
    await queryClient.invalidateQueries();
    void logSecurityEvent("Profile updated", "Personal and medical details saved");
    toast.success("Profile updated");
  }

  async function saveContacts() {
    if (!user) return;
    const cleaned: { name: string; relationship: string; phone: string; email: string }[] = [];
    for (const draft of drafts) {
      const parsed = contactSchema.safeParse(draft);
      if (!parsed.success) {
        toast.error(firstIssue(parsed.error));
        return;
      }
      if (!parsed.data.relationship) {
        toast.error("Each contact needs a relationship");
        return;
      }
      cleaned.push(parsed.data);
    }
    setSaving(true);
    try {
      // Atomic replace: validation and the swap happen in one transaction, so a
      // failure never leaves the person without emergency contacts.
      await saveEmergencyContacts(user.id, cleaned);
    } catch (error) {
      setSaving(false);
      toast.error(
        error instanceof Error
          ? error.message
          : "Unable to save emergency contacts. Your existing contacts were not changed.",
      );
      await queryClient.invalidateQueries({ queryKey: ["contacts"] });
      return;
    }
    setSaving(false);
    await queryClient.invalidateQueries();
    void logSecurityEvent("Emergency contacts changed", "Trusted contact list saved");
    toast.success("Emergency contacts updated successfully");
  }

  return (
    <>
      <PageHeader
        icon={UserRound}
        title="Profile & medical ID"
        description="Keep this accurate — responders read it before they reach you."
      />

      {access.isAdmin && (
        <section className="glass-panel mb-4 rounded-3xl border border-primary/25 bg-primary/5 p-5">
          <p className="flex items-center gap-2 text-sm font-semibold text-primary">
            <ShieldCheck className="size-4" aria-hidden="true" />
            Super Administrator
          </p>
          <dl className="mt-3 grid gap-2 text-sm sm:grid-cols-2">
            <div>
              <dt className="text-xs uppercase tracking-wide text-muted-foreground">Email</dt>
              <dd className="truncate font-medium text-foreground">{user?.email}</dd>
            </div>
            <div>
              <dt className="text-xs uppercase tracking-wide text-muted-foreground">Role</dt>
              <dd className="font-medium text-foreground">Super Administrator</dd>
            </div>
          </dl>
          <Button asChild className="mt-4 rounded-2xl">
            <Link to="/admin">
              <ShieldCheck className="size-4" />
              Open Admin Dashboard
            </Link>
          </Button>
        </section>
      )}

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_340px]">
        <div className="glass-panel rounded-3xl p-5 sm:p-6">
          <Tabs defaultValue="personal">
            <TabsList className="grid w-full grid-cols-3">
              <TabsTrigger value="personal">Personal</TabsTrigger>
              <TabsTrigger value="medical">Medical</TabsTrigger>
              <TabsTrigger value="contacts">Contacts</TabsTrigger>
            </TabsList>

            <TabsContent value="personal" className="mt-6 grid gap-4 sm:grid-cols-2">
              <TextInputField
                label="Full name"
                required
                value={form.full_name}
                error={personalErrors.full_name}
                onBlur={() => markTouched("full_name")}
                onChange={(v) => setForm({ ...form, full_name: v })}
              />
              <PhoneInputField
                label="Phone"
                required
                hint="10-digit Indian mobile number"
                value={form.phone}
                error={personalErrors.phone}
                onBlur={() => markTouched("phone")}
                onChange={(v) => setForm({ ...form, phone: v })}
              />
              <TextInputField
                label="Date of birth"
                type="date"
                max={todayIso()}
                value={form.date_of_birth}
                error={personalErrors.date_of_birth}
                onBlur={() => markTouched("date_of_birth")}
                onChange={(v) => setForm({ ...form, date_of_birth: v })}
              />
              <SelectField
                label="Gender"
                value={form.gender}
                onChange={(v) => setForm({ ...form, gender: v })}
                options={["Female", "Male", "Non-binary", "Prefer not to say"]}
              />
              <TextInputField
                label="City"
                required
                value={form.current_city}
                error={personalErrors.current_city}
                onBlur={() => markTouched("current_city")}
                onChange={(v) => setForm({ ...form, current_city: v })}
              />
              <TextInputField
                label="Home address"
                value={form.home_address}
                error={personalErrors.home_address}
                onBlur={() => markTouched("home_address")}
                onChange={(v) => setForm({ ...form, home_address: v })}
              />
              <div className="sm:col-span-2 space-y-3">
                <FieldError message={profileError} />
                <Button variant="hero" onClick={saveProfile} disabled={saving}>
                  {saving ? (
                    <Loader2 className="size-4 animate-spin" />
                  ) : (
                    <Save className="size-4" />
                  )}
                  Save changes
                </Button>
              </div>
            </TabsContent>


            <TabsContent value="medical" className="mt-6 grid gap-4">
              <SelectField
                label="Blood group"
                value={form.blood_group}
                onChange={(v) => setForm({ ...form, blood_group: v })}
                options={["A+", "A-", "B+", "B-", "AB+", "AB-", "O+", "O-", "Unknown"]}
              />
              <AreaField
                label="Allergies"
                value={form.allergies}
                onChange={(v) => setForm({ ...form, allergies: v })}
              />
              <AreaField
                label="Medical conditions"
                value={form.medical_conditions}
                onChange={(v) => setForm({ ...form, medical_conditions: v })}
              />
              <AreaField
                label="Medications"
                value={form.medications}
                onChange={(v) => setForm({ ...form, medications: v })}
              />
              <Field
                label="Preferred hospital"
                value={form.preferred_hospital}
                onChange={(v) => setForm({ ...form, preferred_hospital: v })}
              />
              <SelectField
                label="Preferred language"
                value={form.language}
                onChange={(v) => setForm({ ...form, language: v })}
                options={["en", "hi", "te"]}
              />
              <div>
                <Button variant="hero" onClick={saveProfile} disabled={saving}>
                  {saving ? (
                    <Loader2 className="size-4 animate-spin" />
                  ) : (
                    <Save className="size-4" />
                  )}
                  Save medical ID
                </Button>
              </div>
            </TabsContent>

            <TabsContent value="contacts" className="mt-6 space-y-5">
              <p className="rounded-2xl bg-info/10 px-4 py-3 text-sm text-info">
                RESQORA always keeps exactly three trusted contacts.
              </p>
              {drafts.map((contact, index) => (
                <div key={index} className="rounded-2xl border border-border bg-card/60 p-4">
                  <p className="mb-3 flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.16em] text-muted-foreground">
                    <PhoneCall className="size-3.5" aria-hidden="true" />
                    Contact {index + 1}
                  </p>
                  <div className="grid gap-4 sm:grid-cols-2">
                    <Field
                      label="Name"
                      value={contact.name}
                      onChange={(v) =>
                        setDrafts((prev) =>
                          prev.map((c, i) => (i === index ? { ...c, name: v } : c)),
                        )
                      }
                    />
                    <Field
                      label="Relationship"
                      value={contact.relationship}
                      onChange={(v) =>
                        setDrafts((prev) =>
                          prev.map((c, i) => (i === index ? { ...c, relationship: v } : c)),
                        )
                      }
                    />
                    <Field
                      label="Phone"
                      type="tel"
                      value={contact.phone}
                      onChange={(v) =>
                        setDrafts((prev) =>
                          prev.map((c, i) => (i === index ? { ...c, phone: v } : c)),
                        )
                      }
                    />
                    <Field
                      label="Email (for emergency emails)"
                      type="email"
                      value={contact.email}
                      onChange={(v) =>
                        setDrafts((prev) =>
                          prev.map((c, i) => (i === index ? { ...c, email: v } : c)),
                        )
                      }
                    />
                  </div>
                </div>
              ))}
              <Button variant="hero" onClick={saveContacts} disabled={saving}>
                {saving ? <Loader2 className="size-4 animate-spin" /> : <Save className="size-4" />}
                Save contacts
              </Button>
            </TabsContent>
          </Tabs>
        </div>

        <div className="space-y-4">
          <SafetyScoreCard score={score} hints={[]} />
          <GuardianCard userId={user?.id} />
          <MedicalQrSection />
        </div>
      </div>
    </>
  );
}

/** Digital medical QR that opens the secure responder profile page. */
function MedicalQrSection() {
  const { user } = useAuth();
  const profile = useQuery(profileQuery(user?.id));
  const contacts = useQuery(contactsQuery(user?.id));
  const link = useQuery({
    queryKey: ["medical-share-link", user?.id],
    enabled: Boolean(user?.id),
    queryFn: async () => ensureMedicalShareLink(user!.id),
  });

  const url = link.data && link.data.active ? shareUrl(link.data) : null;

  return (
    <div className="space-y-3">
      <MedicalIdCard
        profile={profile.data}
        contacts={contacts.data ?? []}
        showQr
        qrValue={url ?? undefined}
        qrCaption={
          url
            ? "Scanning this opens your secure emergency profile — blood group, allergies, conditions, medications, notes and trusted contacts. No login required."
            : undefined
        }
      />
      {url && (
        <div className="glass-panel rounded-2xl p-4">
          <p className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">
            Secure profile link
          </p>
          <p className="mt-2 truncate rounded-xl bg-muted px-3 py-2 font-mono text-xs">{url}</p>
          <div className="mt-3 flex flex-wrap gap-2">
            <Button
              size="sm"
              variant="outline"
              onClick={async () => {
                await copyText(url);
                toast.success("Profile link copied");
              }}
            >
              <Copy className="size-4" />
              Copy link
            </Button>
            <Button
              size="sm"
              variant="outline"
              onClick={async () => {
                await revokeShareLink(link.data!.id);
                await logActivity(user?.id, "Profile updated", "Medical QR link revoked");
                toast.success("Link revoked — generate a new one any time");
                await link.refetch();
              }}
            >
              <ShieldOff className="size-4" />
              Revoke
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}

function Field({
  label,
  value,
  onChange,
  type = "text",
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  type?: string;
}) {
  const id = `field-${label.toLowerCase().replace(/[^a-z]+/g, "-")}`;
  return (
    <div className="space-y-2">
      <Label htmlFor={id}>{label}</Label>
      <Input
        id={id}
        type={type}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="h-11 rounded-xl"
      />
    </div>
  );
}

function AreaField({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
}) {
  const id = `area-${label.toLowerCase().replace(/[^a-z]+/g, "-")}`;
  return (
    <div className="space-y-2">
      <Label htmlFor={id}>{label}</Label>
      <Textarea
        id={id}
        rows={2}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="rounded-xl"
      />
    </div>
  );
}

function SelectField({
  label,
  value,
  onChange,
  options,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  options: string[];
}) {
  return (
    <div className="space-y-2">
      <Label>{label}</Label>
      <Select value={value} onValueChange={onChange}>
        <SelectTrigger className="h-11 w-full rounded-xl">
          <SelectValue placeholder={`Select ${label.toLowerCase()}`} />
        </SelectTrigger>
        <SelectContent>
          {options.map((option) => (
            <SelectItem key={option} value={option}>
              {option}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}
