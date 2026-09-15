import { useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { motion } from "motion/react";
import { Droplets, Phone, Search } from "lucide-react";
import { toast } from "sonner";
import { PageHeader } from "@/components/system/page-header";
import { EmptyState } from "@/components/system/empty-state";
import { PanelSkeleton } from "@/components/system/loading-skeletons";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useAuth } from "@/hooks/use-auth";
import { supabase } from "@/integrations/supabase/client";
import { profileQuery } from "@/lib/api";
import { BLOOD_GROUPS, donorSearchQuery, myDonorQuery, revealDonorPhone } from "@/lib/resqora-data";
import { logActivity } from "@/lib/activity";

export const Route = createFileRoute("/_app/donors")({
  head: () => ({
    meta: [
      { title: "Blood donor directory — RESQORA" },
      {
        name: "description",
        content:
          "Register as a blood donor and search available RESQORA donors by blood group and city when every minute counts.",
      },
      { property: "og:title", content: "RESQORA Blood Donor Directory" },
      {
        property: "og:description",
        content: "Find available donors by blood group and city.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: DonorsPage,
});

function DonorsPage() {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const profile = useQuery(profileQuery(user?.id));
  const mine = useQuery(myDonorQuery(user?.id));
  const [group, setGroup] = useState("all");
  const [city, setCity] = useState("");
  const results = useQuery(donorSearchQuery({ group, city }));

  const [form, setForm] = useState<{ blood_group: string; city: string; phone: string } | null>(
    null,
  );
  const [touched, setTouched] = useState<{ city?: boolean; phone?: boolean }>({});
  const [saveError, setSaveError] = useState<string | null>(null);
  const values = form ?? {
    blood_group: mine.data?.blood_group ?? profile.data?.blood_group ?? BLOOD_GROUPS[0],
    city: mine.data?.city ?? profile.data?.current_city ?? "",
    phone: toPhoneDigits(mine.data?.phone ?? profile.data?.phone ?? ""),
  };

  const cityError = fieldError(citySchema, values.city, { touched: touched.city });
  const phoneError = fieldError(mobileSchema, values.phone, { touched: touched.phone });

  const save = useMutation({
    mutationFn: async (available: boolean) => {
      setTouched({ city: true, phone: true });
      const parsed = donorListingSchema.safeParse({
        blood_group: values.blood_group,
        city: values.city,
        phone: values.phone,
      });
      if (!parsed.success) {
        const message = firstIssue(parsed.error);
        setSaveError(message);
        throw new Error(message);
      }
      setSaveError(null);
      const { error } = await supabase.from("blood_donors").upsert(
        {
          user_id: user!.id,
          full_name: profile.data?.full_name || "RESQORA donor",
          blood_group: parsed.data.blood_group,
          city: parsed.data.city,
          phone: parsed.data.phone,
          available,
        },
        { onConflict: "user_id" },
      );
      if (error) throw new Error(error.message);
      return available;
    },
    onSuccess: async (available) => {
      toast.success(available ? "You're listed as an available donor" : "Availability paused");
      await logActivity(
        user?.id,
        "Profile updated",
        `Blood donor listing ${available ? "enabled" : "paused"}`,
      );
      await queryClient.invalidateQueries({ queryKey: ["blood-donor", user?.id] });
      await queryClient.invalidateQueries({ queryKey: ["blood-donor-search"] });
    },
    onError: (error: Error) => toast.error(error.message),
  });


  return (
    <>
      <PageHeader
        icon={Droplets}
        title="Blood donor directory"
        description="Register your blood group and city, or find an available donor nearby in seconds."
      />

      <div className="grid gap-4 lg:grid-cols-[360px_minmax(0,1fr)]">
        <div className="glass-panel space-y-4 rounded-3xl p-5">
          <div className="flex items-center justify-between gap-3">
            <h2 className="text-sm font-semibold text-foreground">Your donor listing</h2>
            <Switch
              aria-label="Available to donate"
              checked={mine.data?.available ?? false}
              disabled={save.isPending}
              onCheckedChange={(checked) => save.mutate(checked)}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="donor-group">Blood group</Label>
            <Select
              value={values.blood_group}
              onValueChange={(value) => setForm({ ...values, blood_group: value })}
            >
              <SelectTrigger id="donor-group">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {BLOOD_GROUPS.map((item) => (
                  <SelectItem key={item} value={item}>
                    {item}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label htmlFor="donor-city">City</Label>
            <Input
              id="donor-city"
              value={values.city}
              onChange={(event) => setForm({ ...values, city: event.target.value })}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="donor-phone">Contact phone</Label>
            <Input
              id="donor-phone"
              value={values.phone}
              onChange={(event) => setForm({ ...values, phone: event.target.value })}
            />
          </div>
          <Button
            variant="hero"
            className="w-full"
            disabled={save.isPending || !user}
            onClick={() => save.mutate(true)}
          >
            <Droplets className="size-4" />
            {mine.data ? "Update my listing" : "Register as a donor"}
          </Button>
          <p className="text-xs text-muted-foreground">
            Only your name, blood group, city and phone are visible, and only while you're marked
            available.
          </p>
        </div>

        <div className="glass-panel rounded-3xl p-5">
          <h2 className="text-sm font-semibold text-foreground">Find a donor</h2>
          <div className="mt-4 flex flex-wrap gap-2">
            <Select value={group} onValueChange={setGroup}>
              <SelectTrigger className="w-36" aria-label="Filter by blood group">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All groups</SelectItem>
                {BLOOD_GROUPS.map((item) => (
                  <SelectItem key={item} value={item}>
                    {item}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <div className="relative min-w-48 flex-1">
              <Search
                className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
                aria-hidden="true"
              />
              <Input
                aria-label="Search donors by city"
                placeholder="Search by city"
                className="pl-9"
                value={city}
                onChange={(event) => setCity(event.target.value)}
              />
            </div>
          </div>

          {results.isLoading ? (
            <div className="mt-4">
              <PanelSkeleton rows={3} />
            </div>
          ) : (results.data ?? []).length === 0 ? (
            <div className="mt-4">
              <EmptyState
                icon={Droplets}
                title="No available donors match"
                description="Try another blood group or widen the city search."
              />
            </div>
          ) : (
            <ul className="mt-4 space-y-2">
              {(results.data ?? []).map((donor, index) => (
                <motion.li
                  key={donor.id}
                  initial={{ opacity: 0, y: 8 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: index * 0.03 }}
                  className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-border bg-card/60 p-4"
                >
                  <div className="min-w-0">
                    <p className="text-sm font-semibold text-foreground">{donor.full_name}</p>
                    <p className="text-xs text-muted-foreground">{donor.city}</p>
                  </div>
                  <div className="flex items-center gap-2">
                    <Badge className="rounded-full bg-alert text-alert-foreground">
                      {donor.blood_group}
                    </Badge>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={async () => {
                        try {
                          const phone = await revealDonorPhone(donor.id);
                          if (!phone) {
                            toast.error("This donor is no longer available");
                            return;
                          }
                          window.location.href = `tel:${phone.replace(/[^\d+]/g, "")}`;
                        } catch {
                          toast.error("Could not reach this donor right now");
                        }
                      }}
                    >
                      <Phone className="size-4" />
                      Call
                    </Button>
                  </div>
                </motion.li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </>
  );
}
