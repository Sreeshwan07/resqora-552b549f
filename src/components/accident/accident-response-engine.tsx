import { useCallback, useEffect, useState } from "react";
import { Link } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { AnimatePresence, motion } from "motion/react";
import { IdCard, Loader2, ShieldCheck } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { SceneCapture, type CapturedScene } from "@/components/accident/scene-capture";
import { MedicalReportCard } from "@/components/accident/medical-report-card";
import { FirstAidAssistant } from "@/components/accident/first-aid-assistant";
import { EmergencyActionPanel } from "@/components/accident/emergency-action-panel";
import { HospitalShortlist } from "@/components/accident/hospital-shortlist";
import { ResponseTimeline } from "@/components/accident/response-timeline";
import { MedicalIdCard } from "@/components/resqora/medical-id-card";
import { useAuth } from "@/hooks/use-auth";
import { useLivePosition } from "@/hooks/use-live-position";
import { useNearbyServices } from "@/hooks/use-nearby-services";
import { activeEmergencyQuery, contactsQuery, profileQuery } from "@/lib/api";
import { analyzeAccidentScene } from "@/lib/accident.functions";
import { uploadAccidentMedia } from "@/lib/accident-media";
import {
  dbSeverity,
  isUrgent,
  newIncidentId,
  rankBySpecialty,
  type AccidentReport,
  type TimelineEntry,
} from "@/lib/accident";
import { createEmergency } from "@/lib/emergency";
import { ensureLiveShareLink, ensureMedicalShareLink, shareUrl } from "@/lib/share";
import { mapsLink, shareText } from "@/lib/alerts";
import { checkRateLimit } from "@/lib/security";
import { logActivity } from "@/lib/activity";

/** Screen / device orientation captured with the report, when the API exists. */
function useDeviceOrientation() {
  const [orientation, setOrientation] = useState<string | null>(null);

  useEffect(() => {
    const screenType = window.screen?.orientation?.type ?? null;
    if (screenType) setOrientation(screenType.replace(/-/g, " "));
    // Some embeddings disallow the motion sensors; subscribing anyway only
    // produces a permissions-policy error, so check first and skip tilt.
    const featurePolicy = (
      document as Document & { featurePolicy?: { allowsFeature(f: string): boolean } }
    ).featurePolicy;
    const permissionsPolicy = (
      document as Document & { permissionsPolicy?: { allowsFeature(f: string): boolean } }
    ).permissionsPolicy;
    const policy = permissionsPolicy ?? featurePolicy;
    if (policy && !policy.allowsFeature("gyroscope")) return;

    const onTilt = (event: DeviceOrientationEvent) => {
      if (event.alpha == null && event.beta == null) return;
      setOrientation(
        `${screenType ? `${screenType.replace(/-/g, " ")} · ` : ""}tilt ${Math.round(event.beta ?? 0)}° / ${Math.round(event.gamma ?? 0)}°`,
      );
    };
    window.addEventListener("deviceorientation", onTilt, { once: true });
    return () => window.removeEventListener("deviceorientation", onTilt);
  }, []);

  return orientation;
}

export function AccidentResponseEngine() {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const analyze = useServerFn(analyzeAccidentScene);
  const { position, address } = useLivePosition();
  const orientation = useDeviceOrientation();
  const profile = useQuery(profileQuery(user?.id));
  const contacts = useQuery(contactsQuery(user?.id));
  const active = useQuery(activeEmergencyQuery(user?.id));
  const nearby = useNearbyServices(position);

  const [incidentId, setIncidentId] = useState<string | null>(null);
  const [capturedAt, setCapturedAt] = useState<Date | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [report, setReport] = useState<AccidentReport | null>(null);
  const [analysing, setAnalysing] = useState(false);
  const [timeline, setTimeline] = useState<TimelineEntry[]>([]);
  const [sosBusy, setSosBusy] = useState(false);
  const [sharing, setSharing] = useState(false);
  const [medicalQr, setMedicalQr] = useState<string | null>(null);

  const emergency = active.data ?? null;
  const sosActive = Boolean(
    emergency && emergency.status !== "resolved" && emergency.status !== "cancelled",
  );
  const coords = position ? { lat: position.lat, lng: position.lng } : null;

  const record = useCallback((label: string, detail?: string) => {
    setTimeline((prev) => [...prev, { label, detail, at: new Date() }]);
  }, []);

  const hospitals = nearby.data.hospital;
  const bestHospital = report
    ? (rankBySpecialty(hospitals, report.hospitalSpecialty)[0] ?? null)
    : (hospitals[0] ?? null);

  // Hospital recommendation is logged once per analysed incident.
  useEffect(() => {
    if (!report || !bestHospital) return;
    setTimeline((prev) =>
      prev.some((entry) => entry.label === "Hospital recommended")
        ? prev
        : [
            ...prev,
            {
              label: "Hospital recommended",
              detail: `${bestHospital.name} — ${bestHospital.distanceKm.toFixed(1)} km, ETA ~${bestHospital.etaMinutes} min`,
              at: new Date(),
            },
          ],
    );
  }, [report, bestHospital]);

  async function handleCapture(scene: CapturedScene) {
    const limit = checkRateLimit("report");
    if (!limit.allowed) {
      toast.error(limit.message);
      return;
    }
    const id = newIncidentId();
    const now = new Date();
    setIncidentId(id);
    setCapturedAt(now);
    setPreview(scene.dataUrl);
    setReport(null);
    setTimeline([
      {
        label: "Incident reported",
        detail: `${id} · ${scene.kind === "video" ? "Video" : "Photo"}${address ? ` · ${address}` : ""}`,
        at: now,
      },
    ]);
    setAnalysing(true);

    // The real file is stored privately alongside the incident metadata.
    const upload = uploadAccidentMedia({
      userId: user?.id,
      incidentId: id,
      file: scene.file,
      kind: scene.kind,
      coords,
      address: address ?? null,
      capturedAt: now,
    })
      .then((result) => {
        if (result.status === "uploaded") record("Media uploaded", `${scene.kind} stored securely`);
        else if (result.status === "failed") {
          toast.error(result.message ?? "The media upload failed.");
          record("Media upload failed", result.message);
        } else if (result.message) {
          record("Media not stored", result.message);
        }
      })
      .catch((error: unknown) => {
        const message = error instanceof Error ? error.message : "Upload failed";
        toast.error(message);
        record("Media upload failed", message);
      });

    try {
      const result = await analyze({
        data: {
          imageDataUrl: scene.dataUrl,
          mediaKind: scene.kind,
          address: address ?? null,
          capturedAt: now.toISOString(),
        },
      });
      setReport(result);
      record("AI analysis completed", `${result.incidentLabel} · confidence ${result.confidence}%`);
      if (result.confidence < 40) {
        toast.warning(
          "Unable to confidently assess the incident. Please contact emergency services.",
        );
        record(
          "Low AI confidence",
          "Unable to confidently assess the incident. Please contact emergency services.",
        );
      }
      record(
        "Medical report generated",
        `Severity ${result.severity} · ${result.possibleInjuries.length} possible injuries noted`,
      );
      void logActivity(user?.id, "Accident reported", `${id} — ${result.incidentLabel}`);
    } catch (error) {
      toast.error(
        error instanceof Error
          ? error.message
          : "Unable to confidently assess the incident. Please contact emergency services.",
      );
      record(
        "AI analysis failed",
        "Unable to confidently assess the incident. Please contact emergency services.",
      );
    } finally {
      setAnalysing(false);
      await upload;
    }
  }

  async function activateSos() {
    if (!user) {
      toast.error("Sign in to activate SOS — you can still call emergency services now.");
      return;
    }
    setSosBusy(true);
    try {
      const created = await createEmergency({
        userId: user.id,
        type: report?.emergencyType ?? "accident",
        severity: report ? dbSeverity(report.severity) : "high",
        notes: report
          ? [
              `Incident ${incidentId}: ${report.incidentLabel}`,
              report.summary,
              report.possibleInjuries.length
                ? `Possible injuries: ${report.possibleInjuries.join("; ")}`
                : null,
            ]
              .filter(Boolean)
              .join("\n")
          : undefined,
        contactCount: contacts.data?.length ?? 0,
        contacts: contacts.data ?? [],
        profile: profile.data ?? null,
      });
      await queryClient.invalidateQueries();
      record("SOS activated", `Emergency ${created.id.slice(0, 8).toUpperCase()} created`);
      const guardian = created.notifications.find((item) => item.channel === "guardian");
      if (guardian && guardian.status !== "skipped") {
        record("Guardian notified", guardian.detail);
      }
      record(
        "Emergency calls initiated",
        created.notifications.map((item) => `${item.channel}: ${item.status}`).join(" · "),
      );
      toast.success("SOS active — your contacts have been alerted");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not activate SOS");
    } finally {
      setSosBusy(false);
    }
  }

  async function shareLiveLocation() {
    setSharing(true);
    try {
      let link: string | null = null;
      if (user && emergency) {
        const share = await ensureLiveShareLink(user.id, emergency.id);
        link = shareUrl(share);
      }
      const text = [
        `🚨 RESQORA incident ${incidentId ?? ""}`.trim(),
        report ? `${report.incidentLabel} — severity ${report.severity}` : null,
        address ? `Location: ${address}` : null,
        coords ? mapsLink(coords) : null,
        link ? `Live tracking: ${link}` : null,
      ]
        .filter(Boolean)
        .join("\n");
      await shareText("RESQORA emergency location", text);
      record("Location shared", link ? "Live tracking link shared" : "Map location shared");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not share the location");
    } finally {
      setSharing(false);
    }
  }

  // Responder QR opens the live medical profile page for signed-in users.
  useEffect(() => {
    if (!user || !report) return;
    let alive = true;
    void ensureMedicalShareLink(user.id)
      .then((link) => {
        if (alive) setMedicalQr(shareUrl(link));
      })
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, [user, report]);

  const urgent = report ? isUrgent(report.severity) : false;

  return (
    <div className="space-y-4">
      <SceneCapture busy={analysing} onCapture={handleCapture} />

      {analysing && (
        <div className="space-y-2 rounded-3xl border border-alert/40 bg-alert/5 p-4">
          <p className="flex items-center gap-2 text-sm font-semibold text-foreground">
            <Loader2 className="size-4 animate-spin" aria-hidden="true" />
            Analysing the scene — usually under 15 seconds
          </p>
          <ul className="space-y-1 text-xs text-muted-foreground">
            <li>• Incident {incidentId} created with GPS, address and timestamp</li>
            <li>• Detecting emergency type, severity and possible injuries</li>
            <li>• Selecting the right specialist hospitals nearby</li>
          </ul>
          <div className="h-1.5 overflow-hidden rounded-full bg-muted">
            <div className="h-full w-1/2 animate-pulse rounded-full bg-alert" />
          </div>
        </div>
      )}

      <AnimatePresence>
        {report && incidentId && capturedAt && (
          <motion.div
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            className="space-y-4"
          >
            <MedicalReportCard
              report={report}
              preview={preview}
              incidentId={incidentId}
              address={address ?? nearby.manualLabel ?? null}
              capturedAt={capturedAt}
              orientation={orientation}
              coords={coords}
            />

            <FirstAidAssistant
              title={report.firstAid.title}
              steps={report.firstAid.steps}
              onComplete={() => record("First aid guidance completed")}
            />

            {urgent && (
              <EmergencyActionPanel
                hospital={bestHospital}
                sosActive={sosActive}
                sosBusy={sosBusy}
                sharing={sharing}
                onActivateSos={activateSos}
                onShareLocation={shareLiveLocation}
              />
            )}

            <HospitalShortlist
              hospitals={hospitals}
              specialty={report.hospitalSpecialty}
              loading={nearby.isLoading || nearby.isFetching}
              onCall={(place) => record("Hospital called", place.name)}
              onNavigate={(place) => record("Navigation started", place.name)}
            />

            <section aria-label="Digital medical ID" className="space-y-3">
              <h2 className="flex items-center gap-2 text-base font-semibold text-foreground">
                <IdCard className="size-4 text-primary" aria-hidden="true" />
                Digital medical ID
              </h2>
              {user ? (
                <MedicalIdCard
                  profile={profile.data}
                  contacts={contacts.data ?? []}
                  showQr
                  qrValue={medicalQr ?? undefined}
                  qrCaption="Responders and your guardian can scan this to open the emergency profile."
                />
              ) : (
                <div className="glass-panel flex flex-wrap items-center justify-between gap-3 rounded-2xl p-4">
                  <p className="text-sm text-muted-foreground">
                    Sign in to attach the injured person's RESQORA medical card and guardian
                    details.
                  </p>
                  <Button asChild variant="outline" className="rounded-xl">
                    <Link to="/auth">
                      <ShieldCheck className="size-4" aria-hidden="true" />
                      Sign in
                    </Link>
                  </Button>
                </div>
              )}
            </section>
          </motion.div>
        )}
      </AnimatePresence>

      <ResponseTimeline entries={timeline} />
    </div>
  );
}
