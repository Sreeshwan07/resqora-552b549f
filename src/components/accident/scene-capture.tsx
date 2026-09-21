import { useCallback, useEffect, useRef, useState } from "react";
import {
  Camera,
  Check,
  FileVideo,
  ImageUp,
  Loader2,
  RefreshCw,
  SwitchCamera,
  TriangleAlert,
  Video,
} from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { compressPhoto, MAX_MEDIA_BYTES } from "@/lib/accident-media";

const MAX_RECORD_SECONDS = 60;

function readFile(file: File | Blob) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(new Error("Could not read the file"));
    reader.readAsDataURL(file);
  });
}

/** A video is reduced to one clear key frame in the browser before AI analysis. */
function grabVideoFrame(source: File | Blob) {
  return new Promise<string>((resolve, reject) => {
    const video = document.createElement("video");
    const url = URL.createObjectURL(source);
    video.preload = "auto";
    video.muted = true;
    video.playsInline = true;
    video.src = url;
    const fail = () => {
      URL.revokeObjectURL(url);
      reject(new Error("Could not read the video"));
    };
    video.onloadeddata = () => {
      video.currentTime = Math.min(0.6, (video.duration || 1) / 2);
    };
    video.onseeked = () => {
      const canvas = document.createElement("canvas");
      canvas.width = video.videoWidth || 640;
      canvas.height = video.videoHeight || 360;
      const ctx = canvas.getContext("2d");
      if (!ctx) return fail();
      ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
      URL.revokeObjectURL(url);
      resolve(canvas.toDataURL("image/jpeg", 0.85));
    };
    video.onerror = fail;
  });
}

function permissionMessage(error: unknown) {
  const name = error instanceof DOMException ? error.name : "";
  if (name === "NotAllowedError" || name === "SecurityError")
    return "Camera access is blocked. Allow Camera for this site in your browser settings (iPhone: Settings → Safari → Camera), then try again. You can upload a photo or video meanwhile.";
  if (name === "NotFoundError" || name === "DevicesNotFoundError")
    return "No camera was found on this device — upload a photo or video instead.";
  if (name === "NotReadableError" || name === "TrackStartError")
    return "The camera is being used by another app. Close it and try again.";
  if (name === "OverconstrainedError")
    return "That camera isn’t available — try switching camera or upload a file.";
  return "The camera could not be started — upload a photo or video instead.";
}

function pickMimeType() {
  if (typeof MediaRecorder === "undefined") return undefined;
  const candidates = [
    "video/webm;codecs=vp9,opus",
    "video/webm;codecs=vp8,opus",
    "video/webm",
    "video/mp4",
  ];
  return candidates.find((type) => MediaRecorder.isTypeSupported(type));
}

export type CapturedScene = {
  /** Photo, or a key frame of the video — used for AI analysis. */
  dataUrl: string;
  kind: "photo" | "video";
  /** The real captured file, uploaded to private storage. */
  file: Blob;
};

type Pending = { scene: CapturedScene; objectUrl: string; label: string };

export function SceneCapture({
  busy,
  onCapture,
}: {
  busy: boolean;
  onCapture: (scene: CapturedScene) => void;
}) {
  const cameraRef = useRef<HTMLInputElement>(null);
  const photoUploadRef = useRef<HTMLInputElement>(null);
  const videoUploadRef = useRef<HTMLInputElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const previewRef = useRef<HTMLVideoElement>(null);

  const [facing, setFacing] = useState<"environment" | "user">("environment");
  const [cameraOpen, setCameraOpen] = useState(false);
  const [recording, setRecording] = useState(false);
  const [seconds, setSeconds] = useState(0);
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [preparing, setPreparing] = useState(false);
  const [pending, setPending] = useState<Pending | null>(null);

  const closeCamera = useCallback(() => {
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
    if (previewRef.current) previewRef.current.srcObject = null;
    setCameraOpen(false);
    setRecording(false);
    setSeconds(0);
  }, []);

  useEffect(() => () => closeCamera(), [closeCamera]);

  useEffect(() => {
    if (!recording) return;
    const id = window.setInterval(() => setSeconds((value) => value + 1), 1000);
    return () => window.clearInterval(id);
  }, [recording]);

  const stopRecording = useCallback(() => {
    if (recorderRef.current?.state === "recording") recorderRef.current.stop();
  }, []);

  useEffect(() => {
    if (recording && seconds >= MAX_RECORD_SECONDS) stopRecording();
  }, [seconds, recording, stopRecording]);

  function clearPending() {
    setPending((current) => {
      if (current) URL.revokeObjectURL(current.objectUrl);
      return null;
    });
  }

  async function stage(file: Blob, kind: "photo" | "video", label: string) {
    setPreparing(true);
    try {
      // Photos are downscaled before storage so uploads stay small and the AI
      // analysis gets a leaner payload; videos are kept as recorded.
      const stored = kind === "photo" ? await compressPhoto(file) : file;
      const dataUrl = kind === "video" ? await grabVideoFrame(file) : await readFile(stored);
      clearPending();
      setPending({
        scene: { dataUrl, kind, file: stored },
        objectUrl: URL.createObjectURL(stored),
        label,
      });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not read that file");
    } finally {
      setPreparing(false);
    }
  }

  async function handleFile(file: File, expect: "photo" | "video" | "any") {
    const isVideo = file.type.startsWith("video/");
    const isImage = file.type.startsWith("image/");
    if (!isVideo && !isImage) {
      toast.error("Please choose a photo or video of the scene.");
      return;
    }
    if (expect === "photo" && isVideo) {
      toast.error("That’s a video — use “Upload video” for clips.");
      return;
    }
    if (expect === "video" && isImage) {
      toast.error("That’s a photo — use “Upload photo” for images.");
      return;
    }
    if (file.size === 0) {
      toast.error("That file is empty — try again.");
      return;
    }
    if (file.size > MAX_MEDIA_BYTES) {
      toast.error("That file is larger than 60 MB — choose a shorter clip.");
      return;
    }
    await stage(file, isVideo ? "video" : "photo", file.name);
    for (const ref of [cameraRef, photoUploadRef, videoUploadRef])
      if (ref.current) ref.current.value = "";
  }

  async function openCamera(mode: "environment" | "user" = facing) {
    if (typeof MediaRecorder === "undefined" || !navigator.mediaDevices?.getUserMedia) {
      setError("Video recording isn’t supported in this browser — upload a video instead.");
      return;
    }
    setStarting(true);
    setError(null);
    try {
      streamRef.current?.getTracks().forEach((track) => track.stop());
      let stream: MediaStream;
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: mode, width: { ideal: 1280 } },
          audio: true,
        });
      } catch (audioError) {
        const name = audioError instanceof DOMException ? audioError.name : "";
        if (name === "NotAllowedError" || name === "SecurityError") throw audioError;
        // Continue silently without audio when only the microphone is missing.
        stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: mode, width: { ideal: 1280 } },
          audio: false,
        });
        toast.info("Recording without audio — no microphone is available.");
      }
      streamRef.current = stream;
      setFacing(mode);
      setCameraOpen(true);
      clearPending();
      // The <video> element mounts with cameraOpen, so attach on the next frame.
      requestAnimationFrame(() => {
        if (previewRef.current) {
          previewRef.current.srcObject = stream;
          void previewRef.current.play().catch(() => undefined);
        }
      });
    } catch (err) {
      setError(permissionMessage(err));
      closeCamera();
    } finally {
      setStarting(false);
    }
  }

  function startRecording() {
    const stream = streamRef.current;
    if (!stream) {
      setError("The camera is not ready — reopen it and try again.");
      return;
    }
    try {
      const mimeType = pickMimeType();
      const chunks: Blob[] = [];
      const recorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
      recorder.ondataavailable = (event) => {
        if (event.data.size > 0) chunks.push(event.data);
      };
      recorder.onerror = () => {
        setRecording(false);
        toast.error("Recording failed — try again or upload a video.");
      };
      recorder.onstop = async () => {
        setRecording(false);
        const duration = seconds;
        setSeconds(0);
        const blob = new Blob(chunks, { type: recorder.mimeType || mimeType || "video/webm" });
        if (blob.size === 0) {
          toast.error("Nothing was recorded — try again.");
          return;
        }
        closeCamera();
        await stage(blob, "video", `Recorded clip · ${Math.max(1, duration)}s`);
      };
      recorderRef.current = recorder;
      recorder.start(1000);
      setSeconds(0);
      setRecording(true);
    } catch {
      toast.error("Recording could not start on this device — upload a video instead.");
    }
  }

  const disabled = busy || preparing;

  return (
    <section aria-label="Capture the accident scene" className="glass-panel rounded-3xl p-4 sm:p-5">
      <h2 className="text-base font-semibold text-foreground">Capture the scene</h2>
      <p className="mt-1 text-sm text-muted-foreground">
        Photo, a clip up to {MAX_RECORD_SECONDS}s, or an existing file. Location and time are
        attached automatically, and the file is stored privately to your incident.
      </p>

      {error && (
        <p className="mt-3 flex items-start gap-2 rounded-2xl border border-alert/40 bg-alert/5 p-3 text-xs text-foreground">
          <TriangleAlert className="mt-0.5 size-3.5 shrink-0 text-alert" aria-hidden="true" />
          {error}
        </p>
      )}

      {cameraOpen && (
        <div className="mt-4 overflow-hidden rounded-2xl border border-border">
          <video
            ref={previewRef}
            muted
            playsInline
            autoPlay
            className="h-56 w-full bg-black object-cover"
          />
          <div className="flex flex-wrap items-center justify-between gap-2 bg-card px-3 py-2">
            <span className="flex items-center gap-2 text-sm font-semibold text-foreground">
              {recording ? (
                <>
                  <span
                    className="size-2.5 animate-pulse rounded-full bg-alert"
                    aria-hidden="true"
                  />
                  Recording {seconds}s / {MAX_RECORD_SECONDS}s
                </>
              ) : (
                "Camera ready"
              )}
            </span>
            <div className="flex items-center gap-2">
              {!recording && (
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => void openCamera(facing === "environment" ? "user" : "environment")}
                  aria-label="Switch camera"
                >
                  <SwitchCamera className="size-4" aria-hidden="true" />
                  Flip
                </Button>
              )}
              <Button
                size="sm"
                className={recording ? "bg-alert text-alert-foreground hover:bg-alert/90" : ""}
                onClick={() => (recording ? stopRecording() : startRecording())}
              >
                {recording ? "Stop recording" : "Record"}
              </Button>
              {!recording && (
                <Button size="sm" variant="ghost" onClick={closeCamera}>
                  Close
                </Button>
              )}
            </div>
          </div>
        </div>
      )}

      {pending && (
        <div className="mt-4 space-y-3 rounded-2xl border border-primary/30 bg-primary/5 p-3">
          {pending.scene.kind === "video" ? (
            <video
              src={pending.objectUrl}
              controls
              playsInline
              className="h-56 w-full rounded-xl bg-black object-contain"
            />
          ) : (
            <img
              src={pending.objectUrl}
              alt="Captured accident scene preview"
              className="h-56 w-full rounded-xl bg-black object-contain"
            />
          )}
          <p className="truncate text-xs text-muted-foreground">{pending.label}</p>
          <div className="grid gap-2 sm:grid-cols-2">
            <Button
              variant="outline"
              className="rounded-xl"
              disabled={disabled}
              onClick={() => {
                const kind = pending.scene.kind;
                clearPending();
                if (kind === "video") void openCamera();
                else cameraRef.current?.click();
              }}
            >
              <RefreshCw className="size-4" aria-hidden="true" />
              Retake
            </Button>
            <Button
              className="rounded-xl bg-alert text-alert-foreground hover:bg-alert/90"
              disabled={disabled}
              onClick={() => {
                const scene = pending.scene;
                clearPending();
                onCapture(scene);
              }}
            >
              {busy ? (
                <Loader2 className="size-4 animate-spin" aria-hidden="true" />
              ) : (
                <Check className="size-4" aria-hidden="true" />
              )}
              Confirm &amp; analyse
            </Button>
          </div>
        </div>
      )}

      <div className="mt-4 grid gap-3 sm:grid-cols-2">
        <Button
          size="xl"
          disabled={disabled || recording}
          onClick={() => cameraRef.current?.click()}
          className="h-16 rounded-2xl bg-alert text-base font-bold text-alert-foreground hover:bg-alert/90"
        >
          <Camera className="size-5" aria-hidden="true" />
          Take photo
        </Button>
        <Button
          size="xl"
          variant="outline"
          disabled={disabled || starting}
          onClick={() => (cameraOpen ? closeCamera() : void openCamera())}
          className="soft-card h-16 rounded-2xl text-base font-bold"
        >
          {starting ? (
            <Loader2 className="size-5 animate-spin" aria-hidden="true" />
          ) : (
            <Video className="size-5" aria-hidden="true" />
          )}
          {cameraOpen ? "Close camera" : "Record video"}
        </Button>
        <Button
          size="xl"
          variant="outline"
          disabled={disabled}
          onClick={() => photoUploadRef.current?.click()}
          className="soft-card h-16 rounded-2xl text-base font-bold"
        >
          <ImageUp className="size-5" aria-hidden="true" />
          Upload photo
        </Button>
        <Button
          size="xl"
          variant="outline"
          disabled={disabled}
          onClick={() => videoUploadRef.current?.click()}
          className="soft-card h-16 rounded-2xl text-base font-bold"
        >
          <FileVideo className="size-5" aria-hidden="true" />
          Upload video
        </Button>
      </div>

      {preparing && (
        <p className="mt-3 flex items-center gap-2 text-xs text-muted-foreground">
          <Loader2 className="size-3.5 animate-spin" aria-hidden="true" />
          Preparing the preview…
        </p>
      )}

      <input
        ref={cameraRef}
        type="file"
        accept="image/*"
        capture="environment"
        className="sr-only"
        tabIndex={-1}
        aria-label="Take an accident photo"
        onChange={(event) => {
          const file = event.target.files?.[0];
          if (file) void handleFile(file, "photo");
        }}
      />
      <input
        ref={photoUploadRef}
        type="file"
        accept="image/*"
        className="sr-only"
        tabIndex={-1}
        aria-label="Upload an accident photo"
        onChange={(event) => {
          const file = event.target.files?.[0];
          if (file) void handleFile(file, "photo");
        }}
      />
      <input
        ref={videoUploadRef}
        type="file"
        accept="video/*"
        className="sr-only"
        tabIndex={-1}
        aria-label="Upload an accident video"
        onChange={(event) => {
          const file = event.target.files?.[0];
          if (file) void handleFile(file, "video");
        }}
      />
    </section>
  );
}
