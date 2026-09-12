import { useEffect, useMemo, useState } from "react";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { AnimatePresence, motion } from "motion/react";
import {
  ArrowLeft,
  ArrowRight,
  HeartPulse,
  Loader2,
  PhoneCall,
  ShieldCheck,
  UserRound,
} from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/use-auth";
import {
  profileQuery,
  contactsQuery,
  computeSafetyScore,
  notify,
  type Profile,
  type EmergencyContact,
} from "@/lib/api";
import { saveEmergencyContacts, validateContacts } from "@/lib/contacts";
import {
  PhoneInputField,
  TextInputField,
  FieldError,
} from "@/components/system/validated-field";
import {
  citySchema,
  fieldError,
  firstIssue,
  mobileSchema,
  normalizeMobile,
  optionalAddressSchema,
  optionalDobSchema,
  personNameSchema,
  profileDetailsSchema,
  relationshipSchema,
  todayIso,
  toPhoneDigits,
} from "@/lib/validation";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Progress } from "@/components/ui/progress";
import { Logo } from "@/components/brand/logo";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

export const Route = createFileRoute("/onboarding")({
  ssr: false,
  head: () => ({
    meta: [
      { title: "Set up your safety profile — RESQORA" },
      {
        name: "description",
        content:
          "Complete your RESQORA onboarding: personal details, medical ID and three trusted emergency contacts.",
      },
      { property: "og:title", content: "Set up your RESQORA safety profile" },
      { property: "og:description", content: "Personal details, medical ID and trusted contacts." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: OnboardingPage,
});

type ContactDraft = { name: string; relationship: string; phone: string };

const emptyContacts: ContactDraft[] = [
  { name: "", relationship: "", phone: "" },
  { name: "", relationship: "", phone: "" },
  { name: "", relationship: "", phone: "" },
];

const steps = [
  { title: "Personal details", description: "Who we tell responders you are.", icon: UserRound },
  {
    title: "Medical ID",
    description: "What paramedics need in the first 60 seconds.",
    icon: HeartPulse,
  },
  {
    title: "Emergency contacts",
    description: "Exactly three people we alert instantly.",
    icon: PhoneCall,
  },
  {
    title: "Review & activate",
    description: "Confirm and switch protection on.",
    icon: ShieldCheck,
  },
];

function OnboardingPage() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { user, loading } = useAuth();
  const { data: profile } = useQuery(profileQuery(user?.id));
  const { data: existingContacts } = useQuery(contactsQuery(user?.id));

  const [step, setStep] = useState(0);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({
    full_name: "",
    date_of_birth: "",
    gender: "",
    phone: "",
    home_address: "",
    current_city: "",
    blood_group: "",
    allergies: "",
    medical_conditions: "",
    medications: "",
  });
  const [contacts, setContacts] = useState<ContactDraft[]>(emptyContacts);
  const [touched, setTouched] = useState<Record<string, boolean>>({});
  const [formError, setFormError] = useState<string | null>(null);

  const markTouched = (key: string) => setTouched((prev) => ({ ...prev, [key]: true }));


  useEffect(() => {
    if (!loading && !user) navigate({ to: "/auth", replace: true });
  }, [loading, user, navigate]);

  useEffect(() => {
    if (!profile) return;
    setForm((prev) => ({
      ...prev,
      full_name: profile.full_name ?? prev.full_name,
      date_of_birth: profile.date_of_birth ?? prev.date_of_birth,
      gender: profile.gender ?? prev.gender,
      phone: toPhoneDigits(profile.phone ?? prev.phone),
      home_address: profile.home_address ?? prev.home_address,
      current_city: profile.current_city ?? prev.current_city,
      blood_group: profile.blood_group ?? prev.blood_group,
      allergies: profile.allergies ?? prev.allergies,
      medical_conditions: profile.medical_conditions ?? prev.medical_conditions,
      medications: profile.medications ?? prev.medications,
    }));
  }, [profile]);

  useEffect(() => {
    if (existingContacts && existingContacts.length === 3) {
      setContacts(
        existingContacts.map((c) => ({
          name: c.name,
          relationship: c.relationship,
          phone: toPhoneDigits(c.phone),
        })),
      );
    }
  }, [existingContacts]);


  const personalErrors = useMemo(
    () => ({
      full_name: fieldError(personNameSchema, form.full_name, { touched: touched.full_name }),
      phone: fieldError(mobileSchema, form.phone, { touched: touched.phone }),
      date_of_birth: fieldError(optionalDobSchema, form.date_of_birth, {
        touched: touched.date_of_birth,
      }),
      current_city: fieldError(citySchema, form.current_city, { touched: touched.current_city }),
      home_address: fieldError(optionalAddressSchema, form.home_address, {
        touched: touched.home_address,
      }),
    }),
    [form, touched],
  );

  const contactErrors = useMemo(
    () =>
      contacts.map((contact, index) => ({
        name: fieldError(personNameSchema, contact.name, { touched: touched[`c${index}-name`] }),
        relationship: fieldError(relationshipSchema, contact.relationship, {
          touched: touched[`c${index}-relationship`],
        }),
        phone:
          fieldError(mobileSchema, contact.phone, { touched: touched[`c${index}-phone`] }) ??
          (touched[`c${index}-phone`] &&
          contacts.some(
            (other, otherIndex) =>
              otherIndex < index &&
              normalizeMobile(other.phone) &&
              normalizeMobile(other.phone) === normalizeMobile(contact.phone),
          )
            ? "This number is already saved as an emergency contact."
            : null),
      })),
    [contacts, touched],
  );

  const stepValid = useMemo(() => {
    if (step === 0) {
      return (
        !fieldError(personNameSchema, form.full_name) &&
        !fieldError(mobileSchema, form.phone) &&
        !fieldError(citySchema, form.current_city) &&
        !fieldError(optionalDobSchema, form.date_of_birth) &&
        !fieldError(optionalAddressSchema, form.home_address)
      );
    }
    if (step === 1) return Boolean(form.blood_group);
    if (step === 2) {
      const checked = validateContacts(contacts, { ownPhone: form.phone });
      return checked.ok;
    }
    return true;
  }, [step, form, contacts]);

  function touchAll(keys: string[]) {
    setTouched((prev) => {
      const next = { ...prev };
      for (const key of keys) next[key] = true;
      return next;
    });
  }

  function handleContinue() {
    if (step === 0) touchAll(["full_name", "phone", "date_of_birth", "current_city", "home_address"]);
    if (step === 2)
      touchAll(
        contacts.flatMap((_, index) => [
          `c${index}-name`,
          `c${index}-relationship`,
          `c${index}-phone`,
        ]),
      );
    if (!stepValid) {
      setFormError(
        step === 2
          ? "Please fix the highlighted contact details before continuing."
          : "Please fix the highlighted fields before continuing.",
      );
      return;
    }
    setFormError(null);
    setStep((s) => s + 1);
  }

  async function activate() {
    if (!user) return;
    const parsedProfile = profileDetailsSchema.safeParse({
      full_name: form.full_name,
      phone: form.phone,
      date_of_birth: form.date_of_birth,
      current_city: form.current_city,
      home_address: form.home_address,
    });
    if (!parsedProfile.success) {
      setStep(0);
      setFormError(firstIssue(parsedProfile.error));
      return;
    }
    const checkedContacts = validateContacts(contacts, { ownPhone: form.phone });
    if (!checkedContacts.ok) {
      setStep(2);
      setFormError(checkedContacts.issues[0]?.message ?? "Please check your emergency contacts.");
      return;
    }
    setFormError(null);
    setSaving(true);
    try {
      const { error: profileError } = await supabase
        .from("profiles")
        .update({
          full_name: parsedProfile.data.full_name,
          date_of_birth: parsedProfile.data.date_of_birth,
          gender: form.gender || null,
          phone: parsedProfile.data.phone,
          home_address: parsedProfile.data.home_address,
          current_city: parsedProfile.data.current_city,
          blood_group: form.blood_group,
          allergies: form.allergies.trim() || null,
          medical_conditions: form.medical_conditions.trim() || null,
          medications: form.medications.trim() || null,
          onboarding_completed: true,
          safety_score: computeSafetyScore(
            { ...(profile ?? {}), ...form, date_of_birth: form.date_of_birth || null } as Profile,
            [1, 2, 3] as unknown as EmergencyContact[],
          ),
        })
        .eq("id", user.id);
      if (profileError) throw new Error(profileError.message);

      await saveEmergencyContacts(user.id, checkedContacts.contacts, {
        ownPhone: parsedProfile.data.phone,
      });

      await notify(user.id, {
        category: "system",
        title: "Emergency protection activated",
        body: "Your medical ID and 3 trusted contacts are live. RESQORA is now watching over you.",
      });

      await queryClient.invalidateQueries();
      toast.success("You're protected — welcome to RESQORA");
      navigate({ to: "/dashboard", replace: true });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Could not save your profile";
      setFormError(message);
      toast.error(message);
    } finally {
      setSaving(false);
    }
  }


  const StepIcon = steps[step].icon;

  return (
    <div className="aurora min-h-dvh bg-background px-4 py-8 sm:py-12">
      <div className="mx-auto w-full max-w-3xl">
        <div className="mb-8 flex items-center justify-between gap-4">
          <Logo />
          <span className="text-xs font-semibold uppercase tracking-[0.18em] text-muted-foreground">
            Step {step + 1} of {steps.length}
          </span>
        </div>

        <Progress value={((step + 1) / steps.length) * 100} className="h-1.5" />

        <div className="glass-panel mt-6 rounded-3xl p-6 sm:p-8">
          <div className="flex items-start gap-4">
            <span className="grid size-12 shrink-0 place-items-center rounded-2xl bg-linear-to-br from-primary/15 to-alert/15 text-primary">
              <StepIcon className="size-6" aria-hidden="true" />
            </span>
            <div className="min-w-0">
              <h1 className="text-xl font-semibold text-foreground">{steps[step].title}</h1>
              <p className="mt-1 text-sm text-muted-foreground">{steps[step].description}</p>
            </div>
          </div>

          <AnimatePresence mode="wait">
            <motion.div
              key={step}
              initial={{ opacity: 0, x: 24 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -24 }}
              transition={{ duration: 0.25, ease: "easeOut" }}
              className="mt-8"
            >
              {step === 0 && (
                <div className="grid gap-4 sm:grid-cols-2">
                  <TextInputField
                    label="Full name"
                    required
                    value={form.full_name}
                    error={personalErrors.full_name}
                    onBlur={() => markTouched("full_name")}
                    onChange={(v) => setForm({ ...form, full_name: v })}
                  />
                  <PhoneInputField
                    label="Phone number"
                    required
                    value={form.phone}
                    error={personalErrors.phone}
                    hint="10-digit Indian mobile number"
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
                </div>
              )}


              {step === 1 && (
                <div className="grid gap-4">
                  <SelectField
                    label="Blood group"
                    value={form.blood_group}
                    onChange={(v) => setForm({ ...form, blood_group: v })}
                    options={["A+", "A-", "B+", "B-", "AB+", "AB-", "O+", "O-", "Unknown"]}
                  />
                  <AreaField
                    label="Allergies"
                    placeholder="Penicillin, peanuts, latex…"
                    value={form.allergies}
                    onChange={(v) => setForm({ ...form, allergies: v })}
                  />
                  <AreaField
                    label="Medical conditions"
                    placeholder="Asthma, type 1 diabetes, epilepsy…"
                    value={form.medical_conditions}
                    onChange={(v) => setForm({ ...form, medical_conditions: v })}
                  />
                  <AreaField
                    label="Current medications"
                    placeholder="Insulin 10u, salbutamol inhaler…"
                    value={form.medications}
                    onChange={(v) => setForm({ ...form, medications: v })}
                  />
                </div>
              )}

              {step === 2 && (
                <div className="space-y-5">
                  <p className="rounded-2xl bg-info/10 px-4 py-3 text-sm text-info">
                    RESQORA requires exactly three contacts so someone always answers.
                  </p>
                  {contacts.map((contact, index) => (
                    <div key={index} className="rounded-2xl border border-border bg-card/60 p-4">
                      <p className="mb-3 text-xs font-semibold uppercase tracking-[0.16em] text-muted-foreground">
                        Contact {index + 1}
                      </p>
                      <div className="grid gap-4 sm:grid-cols-3">
                        <TextInputField
                          label="Name"
                          required
                          value={contact.name}
                          error={contactErrors[index]?.name}
                          onBlur={() => markTouched(`c${index}-name`)}
                          onChange={(v) => updateContact(setContacts, index, { name: v })}
                        />
                        <TextInputField
                          label="Relationship"
                          required
                          value={contact.relationship}
                          error={contactErrors[index]?.relationship}
                          onBlur={() => markTouched(`c${index}-relationship`)}
                          onChange={(v) => updateContact(setContacts, index, { relationship: v })}
                        />
                        <PhoneInputField
                          label="Phone"
                          required
                          value={contact.phone}
                          error={contactErrors[index]?.phone}
                          onBlur={() => markTouched(`c${index}-phone`)}
                          onChange={(v) => updateContact(setContacts, index, { phone: v })}
                        />
                      </div>

                    </div>
                  ))}
                </div>
              )}

              {step === 3 && (
                <div className="space-y-4">
                  <ReviewBlock title="Personal">
                    {form.full_name} · {form.phone} · {form.current_city}
                  </ReviewBlock>
                  <ReviewBlock title="Medical ID">
                    Blood {form.blood_group || "—"} · Allergies: {form.allergies || "none"} ·
                    Conditions: {form.medical_conditions || "none"}
                  </ReviewBlock>
                  <ReviewBlock title="Emergency contacts">
                    {contacts.map((c) => `${c.name} (${c.relationship})`).join(" · ")}
                  </ReviewBlock>
                </div>
              )}
            </motion.div>
          </AnimatePresence>

          <div className="mt-8 flex items-center justify-between gap-3">
            <Button
              variant="ghost"
              onClick={() => setStep((s) => Math.max(0, s - 1))}
              disabled={step === 0 || saving}
            >
              <ArrowLeft className="size-4" />
              Back
            </Button>
            {step < steps.length - 1 ? (
              <Button variant="hero" onClick={() => setStep((s) => s + 1)} disabled={!stepValid}>
                Continue
                <ArrowRight className="size-4" />
              </Button>
            ) : (
              <Button variant="hero" onClick={activate} disabled={saving}>
                {saving ? (
                  <Loader2 className="size-4 animate-spin" />
                ) : (
                  <ShieldCheck className="size-4" />
                )}
                Activate protection
              </Button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function updateContact(
  setContacts: React.Dispatch<React.SetStateAction<ContactDraft[]>>,
  index: number,
  patch: Partial<ContactDraft>,
) {
  setContacts((prev) => prev.map((c, i) => (i === index ? { ...c, ...patch } : c)));
}

function TextField({
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
  const id = label.toLowerCase().replace(/[^a-z]+/g, "-");
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
  placeholder,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
}) {
  const id = label.toLowerCase().replace(/[^a-z]+/g, "-");
  return (
    <div className="space-y-2">
      <Label htmlFor={id}>{label}</Label>
      <Textarea
        id={id}
        rows={2}
        placeholder={placeholder}
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

function ReviewBlock({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="rounded-2xl border border-border bg-card/60 p-4">
      <p className="text-xs font-semibold uppercase tracking-[0.16em] text-muted-foreground">
        {title}
      </p>
      <p className="mt-2 text-sm text-foreground">{children}</p>
    </div>
  );
}
