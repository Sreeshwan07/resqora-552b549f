import { useEffect, useState } from "react";
import { createFileRoute, Link, useNavigate, useSearch } from "@tanstack/react-router";
import { motion } from "motion/react";
import { Eye, EyeOff, Loader2, LockKeyhole, Mail, ShieldCheck, UserRound } from "lucide-react";
import { toast } from "sonner";
import { z } from "zod";
import { supabase } from "@/integrations/supabase/client";
import { lovable } from "@/integrations/lovable";
import {
  markSessionActive,
  resolveDestination,
  setRememberMe,
  storeDestination,
  takeDestination,
} from "@/lib/auth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Logo } from "@/components/brand/logo";
import { logSecurityEvent } from "@/lib/audit";
import {
  checkRateLimit,
  clearRateLimit,
  emailSchema,
  firstIssue,
  passwordSchema,
  personNameSchema,
} from "@/lib/security";
import { FieldError } from "@/components/system/validated-field";
import { fieldError } from "@/lib/validation";


const searchSchema = z.object({
  redirect: z.string().optional(),
});

export const Route = createFileRoute("/auth")({
  ssr: false,
  validateSearch: searchSchema,
  head: () => ({
    meta: [
      { title: "Sign in — RESQORA Emergency Intelligence" },
      {
        name: "description",
        content:
          "Sign in or create your RESQORA account to activate AI-powered emergency response, crash detection and trusted contacts.",
      },
      { property: "og:title", content: "Sign in — RESQORA" },
      {
        property: "og:description",
        content: "Access your RESQORA emergency intelligence dashboard.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: AuthPage,
});

function AuthPage() {
  const navigate = useNavigate();
  const search = useSearch({ from: "/auth" });
  const [mode, setMode] = useState("signin");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [fullName, setFullName] = useState("");
  const [busy, setBusy] = useState(false);
  const [googleBusy, setGoogleBusy] = useState(false);
  const [remember, setRemember] = useState(true);
  const [sent, setSent] = useState<null | "confirm" | "reset">(null);
  const [touched, setTouched] = useState<{ email?: boolean; password?: boolean; name?: boolean }>(
    {},
  );

  const emailError = fieldError(emailSchema, email, { touched: touched.email });
  const nameError = fieldError(personNameSchema, fullName, { touched: touched.name });
  const passwordError = fieldError(passwordSchema, password, { touched: touched.password });


  const preferred = search.redirect && search.redirect.startsWith("/") ? search.redirect : null;

  useEffect(() => {
    supabase.auth.getSession().then(async ({ data }) => {
      const user = data.session?.user;
      if (!user) return;
      markSessionActive();
      const target = await resolveDestination(user.id, preferred ?? takeDestination());
      navigate({ to: target, replace: true });
    });
  }, [preferred, navigate]);

  async function handleGoogle() {
    setGoogleBusy(true);
    storeDestination(preferred ?? undefined);
    setRememberMe(remember);
    const result = await lovable.auth.signInWithOAuth("google", {
      redirect_uri: window.location.origin + "/auth",
    });
    if (result.error) {
      setGoogleBusy(false);
      toast.error(result.error.message || "Google sign-in failed. Please try again.");
      return;
    }
    if (result.redirected) return;
    const { data } = await supabase.auth.getUser();
    setGoogleBusy(false);
    if (!data.user) {
      toast.error("Could not complete Google sign-in.");
      return;
    }
    toast.success("Signed in with Google");
    navigate({ to: await resolveDestination(data.user.id, preferred), replace: true });
  }

  async function handleSignIn(event: React.FormEvent) {
    event.preventDefault();
    const parsedEmail = emailSchema.safeParse(email);
    if (!parsedEmail.success || !password) {
      toast.error(
        parsedEmail.success ? "Enter your password to continue" : firstIssue(parsedEmail.error),
      );
      return;
    }
    const limit = checkRateLimit("signin");
    if (!limit.allowed) {
      toast.error(limit.message);
      return;
    }
    setBusy(true);
    setRememberMe(remember);
    const { data, error } = await supabase.auth.signInWithPassword({
      email: parsedEmail.data,
      password,
    });
    setBusy(false);
    if (error) {
      void logSecurityEvent("Sign-in failed", `Failed password sign-in for ${parsedEmail.data}`);
      toast.error(
        error.message.toLowerCase().includes("invalid")
          ? "Those credentials don't match an RESQORA account."
          : error.message,
      );
      return;
    }
    clearRateLimit("signin");
    void logSecurityEvent("Sign-in succeeded", "Password sign-in");
    toast.success("Welcome back to RESQORA");
    navigate({ to: await resolveDestination(data.user!.id, preferred), replace: true });
  }

  async function handleSignUp(event: React.FormEvent) {
    event.preventDefault();
    const parsedName = personNameSchema.safeParse(fullName);
    const parsedEmail = emailSchema.safeParse(email);
    const parsedPassword = passwordSchema.safeParse(password);
    if (!parsedName.success) {
      toast.error(firstIssue(parsedName.error));
      return;
    }
    if (!parsedEmail.success) {
      toast.error(firstIssue(parsedEmail.error));
      return;
    }
    if (!parsedPassword.success) {
      toast.error(firstIssue(parsedPassword.error));
      return;
    }
    const limit = checkRateLimit("signup");
    if (!limit.allowed) {
      toast.error(limit.message);
      return;
    }
    setBusy(true);
    setRememberMe(remember);
    const { data, error } = await supabase.auth.signUp({
      email: parsedEmail.data,
      password,
      options: {
        emailRedirectTo: window.location.origin + "/auth",
        data: { full_name: parsedName.data },
      },
    });
    setBusy(false);
    if (error) {
      toast.error(
        error.message.toLowerCase().includes("already registered")
          ? "That email already has an RESQORA account — try signing in."
          : error.message,
      );
      return;
    }
    void logSecurityEvent("Sign-up requested", `Account requested for ${parsedEmail.data}`);
    if (!data.session) {
      setSent("confirm");
      toast.success("Check your email to confirm your account");
      return;
    }
    toast.success("Account created — let's set up your safety profile");
    navigate({ to: "/onboarding", replace: true });
  }

  async function handleReset(event: React.FormEvent) {
    event.preventDefault();
    const parsedEmail = emailSchema.safeParse(email);
    if (!parsedEmail.success) {
      toast.error(firstIssue(parsedEmail.error));
      return;
    }
    const limit = checkRateLimit("password-reset");
    if (!limit.allowed) {
      toast.error(limit.message);
      return;
    }
    setBusy(true);
    const { error } = await supabase.auth.resetPasswordForEmail(parsedEmail.data, {
      redirectTo: window.location.origin + "/reset-password",
    });
    setBusy(false);
    if (error) {
      toast.error(error.message);
      return;
    }
    void logSecurityEvent("Password reset requested", `Reset requested for ${parsedEmail.data}`);
    setSent("reset");
    toast.success("Reset link sent");
  }

  return (
    <div className="aurora grid min-h-dvh place-items-center bg-background px-4 py-10">
      <motion.div
        initial={{ opacity: 0, y: 16 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.4, ease: "easeOut" }}
        className="w-full max-w-md"
      >
        <div className="mb-6 flex justify-center">
          <Link to="/" aria-label="RESQORA home">
            <Logo />
          </Link>
        </div>

        <div className="glass-panel rounded-3xl p-6 sm:p-8">
          {sent ? (
            <div className="text-center">
              <span className="mx-auto mb-4 grid size-14 place-items-center rounded-2xl bg-primary/10 text-primary">
                <Mail className="size-6" />
              </span>
              <h1 className="text-xl font-semibold text-foreground">Check your inbox</h1>
              <p className="mt-2 text-sm text-muted-foreground">
                {sent === "confirm"
                  ? `We sent a confirmation link to ${email}. Confirm it to activate emergency protection.`
                  : `We sent a password reset link to ${email}.`}
              </p>
              <Button variant="outline" className="mt-6 w-full" onClick={() => setSent(null)}>
                Back to sign in
              </Button>
            </div>
          ) : (
            <Tabs value={mode} onValueChange={setMode}>
              <TabsList className="grid w-full grid-cols-3">
                <TabsTrigger value="signin">Sign in</TabsTrigger>
                <TabsTrigger value="signup">Sign up</TabsTrigger>
                <TabsTrigger value="forgot">Reset</TabsTrigger>
              </TabsList>

              <TabsContent value="signin" className="mt-6">
                <h1 className="text-xl font-semibold text-foreground">Welcome back</h1>
                <p className="mt-1 text-sm text-muted-foreground">
                  Sign in to reach your emergency network in seconds.
                </p>
                <GoogleButton
                  busy={googleBusy}
                  onClick={handleGoogle}
                  label="Continue with Google"
                />
                <Divider />
                <form className="mt-6 space-y-4" onSubmit={handleSignIn}>
                  <Field
                    id="signin-email"
                    label="Email"
                    icon={Mail}
                    type="email"
                    value={email}
                    onChange={setEmail}
                    autoComplete="email"
                  />
                  <Field
                    id="signin-password"
                    label="Password"
                    icon={LockKeyhole}
                    password
                    value={password}
                    onChange={setPassword}
                    autoComplete="current-password"
                  />
                  <div className="flex items-center justify-between">
                    <label className="flex cursor-pointer items-center gap-2 text-sm text-muted-foreground">
                      <Checkbox
                        checked={remember}
                        onCheckedChange={(value) => setRemember(value === true)}
                        aria-label="Remember me"
                      />
                      Remember me
                    </label>
                    <button
                      type="button"
                      className="text-sm font-medium text-primary hover:underline"
                      onClick={() => setMode("forgot")}
                    >
                      Forgot password?
                    </button>
                  </div>
                  <Button type="submit" variant="hero" className="w-full" disabled={busy}>
                    {busy ? (
                      <Loader2 className="size-4 animate-spin" />
                    ) : (
                      <ShieldCheck className="size-4" />
                    )}
                    Sign in
                  </Button>
                </form>
              </TabsContent>

              <TabsContent value="signup" className="mt-6">
                <h1 className="text-xl font-semibold text-foreground">
                  Create your RESQORA account
                </h1>
                <p className="mt-1 text-sm text-muted-foreground">
                  Takes under two minutes to be protected.
                </p>
                <GoogleButton
                  busy={googleBusy}
                  onClick={handleGoogle}
                  label="Sign up with Google"
                />
                <Divider />
                <form className="mt-6 space-y-4" onSubmit={handleSignUp}>
                  <Field
                    id="signup-name"
                    label="Full name"
                    icon={UserRound}
                    value={fullName}
                    onChange={setFullName}
                    autoComplete="name"
                  />
                  <Field
                    id="signup-email"
                    label="Email"
                    icon={Mail}
                    type="email"
                    value={email}
                    onChange={setEmail}
                    autoComplete="email"
                  />
                  <Field
                    id="signup-password"
                    label="Password"
                    icon={LockKeyhole}
                    password
                    value={password}
                    onChange={setPassword}
                    autoComplete="new-password"
                    hint="Minimum 8 characters"
                  />
                  <Button type="submit" variant="hero" className="w-full" disabled={busy}>
                    {busy ? (
                      <Loader2 className="size-4 animate-spin" />
                    ) : (
                      <ShieldCheck className="size-4" />
                    )}
                    Create account
                  </Button>
                </form>
              </TabsContent>

              <TabsContent value="forgot" className="mt-6">
                <h1 className="text-xl font-semibold text-foreground">Reset password</h1>
                <p className="mt-1 text-sm text-muted-foreground">
                  We'll email you a secure link to choose a new password.
                </p>
                <form className="mt-6 space-y-4" onSubmit={handleReset}>
                  <Field
                    id="reset-email"
                    label="Email"
                    icon={Mail}
                    type="email"
                    value={email}
                    onChange={setEmail}
                    autoComplete="email"
                  />
                  <Button type="submit" variant="outline" className="w-full" disabled={busy}>
                    {busy ? (
                      <Loader2 className="size-4 animate-spin" />
                    ) : (
                      <Mail className="size-4" />
                    )}
                    Send reset link
                  </Button>
                </form>
              </TabsContent>
            </Tabs>
          )}
        </div>

        <p className="mt-6 text-center text-xs text-muted-foreground">
          Protected by end-to-end encryption. Your medical data stays private.
        </p>
      </motion.div>
    </div>
  );
}

function Field({
  id,
  label,
  icon: Icon,
  value,
  onChange,
  onBlur,
  type = "text",
  autoComplete,
  hint,
  password,
  error,
}: {
  id: string;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  value: string;
  onChange: (value: string) => void;
  onBlur?: () => void;
  type?: string;
  autoComplete?: string;
  hint?: string;
  password?: boolean;
  error?: string | null;
}) {
  const [visible, setVisible] = useState(false);
  return (
    <div className="space-y-2">
      <Label htmlFor={id}>{label}</Label>
      <div className="relative">
        <Icon className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          id={id}
          type={password ? (visible ? "text" : "password") : type}
          required
          autoComplete={autoComplete}
          value={value}
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? `${id}-error` : undefined}
          onBlur={onBlur}
          onChange={(event) => onChange(event.target.value)}
          className={password ? "h-11 rounded-xl pl-9 pr-11" : "h-11 rounded-xl pl-9"}
        />
        {password && (
          <button
            type="button"
            onClick={() => setVisible((current) => !current)}
            aria-label={visible ? "Hide password" : "Show password"}
            className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground transition-colors hover:text-foreground"
          >
            {visible ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
          </button>
        )}
      </div>
      <FieldError id={`${id}-error`} message={error} />
      {hint && !error && <p className="text-xs text-muted-foreground">{hint}</p>}
    </div>
  );
}


function Divider() {
  return (
    <div className="mt-6 flex items-center gap-3">
      <span className="h-px flex-1 bg-border" />
      <span className="text-xs uppercase tracking-wider text-muted-foreground">or</span>
      <span className="h-px flex-1 bg-border" />
    </div>
  );
}

function GoogleButton({
  busy,
  onClick,
  label,
}: {
  busy: boolean;
  onClick: () => void;
  label: string;
}) {
  return (
    <Button
      type="button"
      variant="outline"
      className="mt-6 h-11 w-full gap-2 rounded-xl"
      disabled={busy}
      onClick={onClick}
    >
      {busy ? <Loader2 className="size-4 animate-spin" /> : <GoogleIcon />}
      {label}
    </Button>
  );
}

function GoogleIcon() {
  return (
    <svg className="size-4" viewBox="0 0 24 24" aria-hidden="true">
      <path
        fill="#4285F4"
        d="M23.52 12.27c0-.85-.08-1.67-.22-2.45H12v4.64h6.46a5.53 5.53 0 0 1-2.4 3.62v3h3.88c2.27-2.09 3.58-5.17 3.58-8.81Z"
      />
      <path
        fill="#34A853"
        d="M12 24c3.24 0 5.96-1.08 7.94-2.92l-3.88-3c-1.08.72-2.45 1.15-4.06 1.15-3.12 0-5.77-2.11-6.72-4.95H1.28v3.1A12 12 0 0 0 12 24Z"
      />
      <path
        fill="#FBBC05"
        d="M5.28 14.28a7.2 7.2 0 0 1 0-4.56v-3.1H1.28a12 12 0 0 0 0 10.76l4-3.1Z"
      />
      <path
        fill="#EA4335"
        d="M12 4.77c1.76 0 3.34.61 4.59 1.8l3.43-3.43C17.95 1.19 15.24 0 12 0A12 12 0 0 0 1.28 6.62l4 3.1C6.23 6.88 8.88 4.77 12 4.77Z"
      />
    </svg>
  );
}
