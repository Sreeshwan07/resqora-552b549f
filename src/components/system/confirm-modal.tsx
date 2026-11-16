import { useEffect, useRef, useState, type ReactNode } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";

export function ConfirmModal({
  open,
  onOpenChange,
  title,
  description,
  confirmLabel = "Confirm",
  cancelLabel = "Cancel",
  tone = "default",
  onConfirm,
  children,
  countdownSeconds,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description: string;
  confirmLabel?: string;
  cancelLabel?: string;
  tone?: "default" | "emergency";
  onConfirm?: () => void;
  children?: ReactNode;
  /** Automatically confirms after this delay; closing the dialog cancels it. */
  countdownSeconds?: number;
}) {
  const [remaining, setRemaining] = useState(countdownSeconds ?? 0);
  const confirmRef = useRef(onConfirm);
  const openChangeRef = useRef(onOpenChange);
  confirmRef.current = onConfirm;
  openChangeRef.current = onOpenChange;

  useEffect(() => {
    if (!open || !countdownSeconds) return;
    const endsAt = Date.now() + countdownSeconds * 1000;
    setRemaining(countdownSeconds);
    const tick = () => {
      const next = Math.max(0, Math.ceil((endsAt - Date.now()) / 1000));
      setRemaining(next);
      if (next === 0) {
        window.clearInterval(timer);
        openChangeRef.current(false);
        confirmRef.current?.();
      }
    };
    const timer = window.setInterval(tick, 200);
    tick();
    return () => window.clearInterval(timer);
  }, [open, countdownSeconds]);

  const counting = Boolean(countdownSeconds && open);
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="rounded-2xl sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>
        {counting && (
          <p
            role="timer"
            aria-live="polite"
            className="rounded-xl bg-alert/10 p-3 text-center text-sm font-bold text-alert"
          >
            Sending SOS in {remaining} second{remaining === 1 ? "" : "s"}. Cancel to stop it.
          </p>
        )}
        {children}
        <DialogFooter className="gap-2 sm:gap-2">
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            {counting ? "Cancel SOS" : cancelLabel}
          </Button>
          <Button
            variant={tone === "emergency" ? "emergency" : "default"}
            disabled={counting}
            onClick={() => {
              onConfirm?.();
              onOpenChange(false);
            }}
          >
            {counting ? `Sending in ${remaining}s` : confirmLabel}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
