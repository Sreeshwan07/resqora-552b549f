import { useEffect, useMemo, useState } from "react";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { motion } from "motion/react";
import {
  AlarmClock,
  Bell,
  Bot,
  Building2,
  Clock3,
  Droplets,
  Flame,
  History as HistoryIcon,
  MapPin,
  PhoneCall,
  QrCode,
  Radar,
  Share2,
  Shield,
  Siren,
  TriangleAlert,
  Users,
} from "lucide-react";
import { toast } from "sonner";
import { ConfirmModal } from "@/components/system/confirm-modal";
import { MedicalIdQr } from "@/components/resqora/medical-id-card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useAuth } from "@/hooks/use-auth";
import { useHydrated } from "@/hooks/use-hydrated";
import {
  activeEmergencyQuery,
  contactsQuery,
  emergenciesQuery,
  getCurrentPosition,
  notificationsQuery,
  profileQuery,
} from "@/lib/api";
import { checkinsQuery } from "@/lib/resqora-data";
import { coordsOf, copyText, mapsLink, shareText } from "@/lib/alerts";
import { createEmergency, statusLabel } from "@/lib/emergency";
import {
  buildSosMessage,
  ensureLiveShareLink,
  ensureMedicalShareLink,
  shareUrl,
} from "@/lib/share";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/_app/dashboard")({
  head: () => ({
    meta: [
      { title: "Home — RESQORA emergency console" },
      {
        name: "description",
        content:
          "Your RESQORA home screen: live safety status, one-tap SOS, live location, medical QR, nearby responders and check-ins.",
      },
      { property: "og:title", content: "RESQORA Home" },
      { property: "og:description", content: "One-tap emergency actions, always within reach." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: HomePage,
});

type StatusTone = "safe" | "pending" | "active" | "enroute" | "resolved";

const STATUS_STYLES: Record<
  StatusTone,
  { dot: string; ring: string; text: string; label: string }
> = {
  safe: {
    dot: "bg-success",
    ring: "border-success/40 bg-success/5",
    text: "text-success",
    label: "Safe",
  },
  pending: {
    dot: "bg-warning",
    ring: "border-warning/40 bg-warning/5",
    text: "text-warning",
    label: "Safety check pending",
  },
  active: {
    dot: "bg-alert",
    ring: "border-alert/50 bg-alert/5",
    text: "text-alert",
    label: "Emergency active",
  },
  enroute: {
    dot: "bg-info",
    ring: "border-info/40 bg-info/5",
    text: "text-info",
    label: "Assistance on the way",
  },
  resolved: {
    dot: "bg-success",
    ring: "border-success/40 bg-success/5",
    text: "text-success",
    label: "Emergency resolved",
  },
};

function HomePage() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const hydrated = useHydrated();

  const profile = useQuery(profileQuery(user?.id));
  const contacts = useQuery(contactsQuery(user?.id));
  const active = useQuery(activeEmergencyQuery(user?.id));
  const emergencies = useQuery(emergenciesQuery(user?.id));
  const notifications = useQuery(notificationsQuery(user?.id));
  const checkins = useQuery(checkinsQuery(user?.id));

  const [now, setNow] = useState(() => new Date());
  const [busy, setBusy] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [qrOpen, setQrOpen] = useState(false);
  const [qrValue, setQrValue] = useState<string | null>(null);

  useEffect(() => {
    const id = window.setInterval(() => setNow(new Date()), 1000);
    return () => window.clearInterval(id);
  }, []);

  const current = active.data ?? null;
  const lastEmergency = (emergencies.data ?? [])[0] ?? null;
  const pendingCheckin = (checkins.data ?? []).find((item) => item.status === "pending") ?? null;
  const unread = (notifications.data ?? []).filter((item) => !item.read).length;
  const disasterAlerts = (notifications.data ?? []).filter(
    (item) => item.category === "safety" && !item.read,
  ).length;
  const primaryContact = (contacts.data ?? [])[0] ?? null;
  const coords = coordsOf(current);

  const tone: StatusTone = useMemo(() => {
    if (current) {
      if (current.status === "active" || current.live_status === "help_arrived") return "enroute";
      return "active";
    }
    if (pendingCheckin) return "pending";
    if (lastEmergency?.status === "resolved") return "resolved";
    return "safe";
  }, [current, pendingCheckin, lastEmergency]);

  const style = STATUS_STYLES[tone];
  const statusText = current ? statusLabel(current.status) : style.label;
  const locationText = coords
    ? `${coords.lat.toFixed(4)}, ${coords.lng.toFixed(4)}`
    : profile.data?.current_city || profile.data?.home_address || "Location not shared";
  const updatedAt =
    current?.location_updated_at ?? current?.updated_at ?? lastEmergency?.updated_at;

  async function triggerSos() {
    if (!user || busy || current) return;
    setBusy(true);
    try {
      const created = await createEmergency({
        userId: user.id,
        type: "sos",
        contactCount: contacts.data?.length ?? 0,
        contacts: contacts.data ?? [],
        profile: profile.data ?? null,
      });
      await queryClient.invalidateQueries();
      if (created.queued) {
        toast.warning("SOS queued on this device — alerts will start automatically when you reconnect");
        return;
      }
      toast.success("SOS activated — check each contact delivery status");
      navigate({ to: "/live" });
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not send SOS");
    } finally {
      setBusy(false);
    }
  }

  async function shareLiveLocation() {
    if (!user || busy) return;
    setBusy(true);
    try {
      let message: string;
      if (current) {
        const link = await ensureLiveShareLink(user.id, current.id);
        message = buildSosMessage({
          emergency: current,
          profile: profile.data,
          link: shareUrl(link),
        });
      } else {
        const position = await getCurrentPosition();
        const point = { lat: position.coords.latitude, lng: position.coords.longitude };
        message = `${profile.data?.full_name || "An RESQORA user"} is sharing a live location.\n${point.lat.toFixed(6)}, ${point.lng.toFixed(6)}\n${mapsLink(point)}`;
      }
      const shared = await shareText("RESQORA live location", message);
      toast.success(shared ? "Location shared" : "Location copied to clipboard");
    } catch {
      toast.error("Could not read your location — check GPS permission");
    } finally {
      setBusy(false);
    }
  }

  async function openMedicalQr() {
    setQrOpen(true);
    if (qrValue || !user) return;
    try {
      const link = await ensureMedicalShareLink(user.id);
      setQrValue(shareUrl(link));
    } catch {
      toast.error("Could not generate your medical QR");
    }
  }

  function callContact() {
    if (!primaryContact) {
      toast.error("Add a trusted contact in your profile first");
      return;
    }
    window.location.href = `tel:${primaryContact.phone.replace(/\s/g, "")}`;
  }

  return (
    <>
      {/* Status card */}
      <section className={cn("rounded-2xl border p-5", style.ring)} aria-live="polite">
        <div className="grid grid-cols-[minmax(0,1fr)_auto] items-start gap-4 sm:flex sm:justify-between">
          <div className="min-w-0">
            <span className="flex items-center gap-2">
              <span className="relative flex size-3 shrink-0">
                <span
                  className={cn(
                    "absolute inline-flex size-3 animate-ping rounded-full opacity-60",
                    style.dot,
                  )}
                />
                <span className={cn("relative inline-flex size-3 rounded-full", style.dot)} />
              </span>
              <span
                className={cn("truncate font-display text-lg font-bold sm:text-xl", style.text)}
              >
                {statusText}
              </span>
            </span>
            <dl className="mt-3 grid gap-x-6 gap-y-1 text-xs sm:grid-cols-3">
              <div className="flex min-w-0 gap-1.5">
                <dt className="text-muted-foreground">Time</dt>
                <dd className="truncate font-medium text-foreground">
                  {hydrated ? now.toLocaleTimeString() : "—"}
                </dd>
              </div>
              <div className="flex min-w-0 gap-1.5">
                <dt className="text-muted-foreground">Location</dt>
                <dd className="truncate font-medium text-foreground">{locationText}</dd>
              </div>
              <div className="flex min-w-0 gap-1.5">
                <dt className="text-muted-foreground">Updated</dt>
                <dd className="truncate font-medium text-foreground">
                  {hydrated && updatedAt ? new Date(updatedAt).toLocaleTimeString() : "—"}
                </dd>
              </div>
            </dl>
          </div>
          {current && (
            <Button asChild variant="emergency" size="sm">
              <Link to="/live">
                <Radar className="size-4" />
                Track
              </Link>
            </Button>
          )}
        </div>
      </section>

      {/* Quick actions */}
      <section aria-label="Quick actions">
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4 lg:grid-cols-7">
          <QuickAction
            icon={Siren}
            label="SOS"
            tone="alert"
            onClick={() => setConfirmOpen(true)}
            disabled={busy || Boolean(current)}
          />
          <QuickAction
            icon={Share2}
            label="Share location"
            onClick={shareLiveLocation}
            disabled={busy}
          />
          <QuickAction icon={PhoneCall} label="Call contact" onClick={callContact} />
          <QuickAction
            icon={Building2}
            label="Hospital"
            to="/nearby"
            search={{ category: "hospital" }}
          />
          <QuickAction icon={Shield} label="Police" to="/nearby" search={{ category: "police" }} />
          <QuickAction icon={QrCode} label="Medical QR" onClick={openMedicalQr} />
          <QuickAction icon={AlarmClock} label="Check-in" to="/checkins" />
        </div>
      </section>

      {/* Feature tiles */}
      <section
        aria-label="RESQORA features"
        className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4"
      >
        <Tile icon={Radar} label="Live location" to="/live" meta={coords ? "Tracking" : "Idle"} />
        <Tile icon={Bot} label="AI assistant" to="/assistant" meta="Triage" />
        <Tile
          icon={Users}
          label="Contacts"
          to="/profile"
          meta={`${contacts.data?.length ?? 0}/3`}
        />
        <Tile icon={Building2} label="Hospitals" to="/nearby" search={{ category: "hospital" }} />
        <Tile icon={Shield} label="Police" to="/nearby" search={{ category: "police" }} />
        <Tile icon={Flame} label="Fire stations" to="/nearby" search={{ category: "fire" }} />
        <Tile
          icon={Droplets}
          label="Blood banks"
          to="/nearby"
          search={{ category: "blood_bank" }}
        />
        <Tile
          icon={AlarmClock}
          label="Safety check-in"
          to="/checkins"
          meta={pendingCheckin ? "Pending" : "Off"}
        />
        <Tile
          icon={HistoryIcon}
          label="History"
          to="/history"
          meta={String(emergencies.data?.length ?? 0)}
        />
        <Tile
          icon={TriangleAlert}
          label="Disaster alerts"
          to="/notifications"
          meta={disasterAlerts ? String(disasterAlerts) : "Clear"}
        />
        <Tile
          icon={Bell}
          label="Notifications"
          to="/notifications"
          meta={unread ? String(unread) : "0"}
        />
        <Tile icon={QrCode} label="Medical ID QR" onClick={openMedicalQr} />
      </section>

      <ConfirmModal
        open={confirmOpen}
        onOpenChange={setConfirmOpen}
        tone="emergency"
        title="Send SOS now?"
        description="RESQORA captures your GPS position and alerts your trusted contacts immediately."
        confirmLabel="Send SOS"
        onConfirm={() => void triggerSos()}
      />

      <Dialog open={qrOpen} onOpenChange={setQrOpen}>
        <DialogContent className="rounded-2xl sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>Medical ID QR</DialogTitle>
          </DialogHeader>
          <div className="flex flex-col items-center gap-3">
            {qrValue ? (
              <>
                <MedicalIdQr value={qrValue} />
                <Button
                  size="sm"
                  variant="outline"
                  onClick={async () => {
                    await copyText(qrValue);
                    toast.success("Link copied");
                  }}
                >
                  Copy link
                </Button>
              </>
            ) : (
              <div className="size-[220px] animate-pulse rounded-xl bg-muted" />
            )}
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}

function QuickAction({
  icon: Icon,
  label,
  onClick,
  to,
  search,
  disabled,
  tone = "default",
}: {
  icon: typeof Siren;
  label: string;
  onClick?: () => void;
  to?: string;
  search?: Record<string, string>;
  disabled?: boolean;
  tone?: "default" | "alert";
}) {
  const className = cn(
    "flex min-h-20 flex-col items-center justify-center gap-1.5 rounded-2xl border p-2 text-center text-xs font-semibold transition active:scale-95",
    tone === "alert"
      ? "border-alert/40 bg-alert/10 text-alert hover:bg-alert/15"
      : "border-border bg-card/70 text-foreground hover:border-primary/40 hover:bg-primary/5",
    disabled && "pointer-events-none opacity-50",
  );

  const content = (
    <>
      <Icon className="size-5" aria-hidden="true" />
      <span className="line-clamp-2 leading-tight">{label}</span>
    </>
  );

  if (to) {
    return (
      <Link to={to} search={search} className={className}>
        {content}
      </Link>
    );
  }
  return (
    <button type="button" onClick={onClick} disabled={disabled} className={className}>
      {content}
    </button>
  );
}

function Tile({
  icon: Icon,
  label,
  to,
  search,
  meta,
  onClick,
}: {
  icon: typeof Siren;
  label: string;
  to?: string;
  search?: Record<string, string>;
  meta?: string;
  onClick?: () => void;
}) {
  const inner = (
    <>
      <span className="grid size-9 place-items-center rounded-xl bg-primary/10 text-primary">
        <Icon className="size-4.5" aria-hidden="true" />
      </span>
      <span className="mt-2 block truncate text-sm font-semibold text-foreground">{label}</span>
      {meta && (
        <Badge variant="secondary" className="mt-1 rounded-full text-[10px] font-semibold">
          {meta}
        </Badge>
      )}
    </>
  );
  const className =
    "glass-panel block w-full rounded-2xl p-4 text-left transition hover:border-primary/40 hover:bg-primary/5 active:scale-[0.98]";

  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.2 }}
    >
      {to ? (
        <Link to={to} search={search} className={className}>
          {inner}
        </Link>
      ) : (
        <button type="button" onClick={onClick} className={className}>
          {inner}
        </button>
      )}
    </motion.div>
  );
}
