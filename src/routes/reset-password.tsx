import { useState } from "react";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { Loader2, LockKeyhole } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Logo } from "@/components/brand/logo";
import { logSecurityEvent } from "@/lib/audit";
import { firstIssue, passwordSchema } from "@/lib/security";

export const Route = createFileRoute("/reset-password")({
  ssr: false,
  head: () => ({
    meta: [
      { title: "Choose a new password — RESQORA" },
      { name: "description", content: "Set a new password for your RESQORA emergency account." },
      { property: "og:title", content: "Reset your RESQORA password" },
      { property: "og:description", content: "Set a new password for your RESQORA account." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: ResetPasswordPage,
});

function ResetPasswordPage() {
  const navigate = useNavigate();
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);
  const [touched, setTouched] = useState<{ password?: boolean; confirm?: boolean }>({});

  const passwordError = fieldError(passwordSchema, password, { touched: touched.password });
  const confirmError =
    touched.confirm && confirm !== password ? "Both passwords must match." : null;

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    setTouched({ password: true, confirm: true });
    const parsed = passwordSchema.safeParse(password);
    if (!parsed.success) {
      toast.error(firstIssue(parsed.error));
      return;
    }
    if (password !== confirm) {
      toast.error("Passwords do not match");
      return;
    }
    setBusy(true);
    const { error } = await supabase.auth.updateUser({ password });
    setBusy(false);
    if (error) {
      toast.error(error.message);
      return;
    }
    void logSecurityEvent("Password changed", "Password updated from a reset link");
    toast.success("Password updated");
    navigate({ to: "/dashboard", replace: true });
  }

  return (
    <div className="aurora grid min-h-dvh place-items-center bg-background px-4">
      <div className="w-full max-w-md">
        <div className="mb-6 flex justify-center">
          <Link to="/" aria-label="RESQORA home">
            <Logo />
          </Link>
        </div>
        <form onSubmit={handleSubmit} className="glass-panel space-y-4 rounded-3xl p-6 sm:p-8">
          <div>
            <h1 className="text-xl font-semibold text-foreground">Choose a new password</h1>
            <p className="mt-1 text-sm text-muted-foreground">
              Pick something strong — this protects your medical data.
            </p>
          </div>
          <div className="space-y-2">
            <Label htmlFor="new-password">New password</Label>
            <div className="relative">
              <LockKeyhole className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                id="new-password"
                type="password"
                required
                value={password}
                aria-invalid={passwordError ? true : undefined}
                aria-describedby={passwordError ? "new-password-error" : undefined}
                onBlur={() => setTouched((prev) => ({ ...prev, password: true }))}
                onChange={(event) => setPassword(event.target.value)}
                className="h-11 rounded-xl pl-9"
              />
            </div>
            <FieldError id="new-password-error" message={passwordError} />
          </div>
          <div className="space-y-2">
            <Label htmlFor="confirm-password">Confirm password</Label>
            <div className="relative">
              <LockKeyhole className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                id="confirm-password"
                type="password"
                required
                value={confirm}
                aria-invalid={confirmError ? true : undefined}
                aria-describedby={confirmError ? "confirm-password-error" : undefined}
                onBlur={() => setTouched((prev) => ({ ...prev, confirm: true }))}
                onChange={(event) => setConfirm(event.target.value)}
                className="h-11 rounded-xl pl-9"
              />
            </div>
            <FieldError id="confirm-password-error" message={confirmError} />
          </div>

          <Button type="submit" variant="hero" className="w-full" disabled={busy}>
            {busy && <Loader2 className="size-4 animate-spin" />}
            Update password
          </Button>
        </form>
      </div>
    </div>
  );
}
