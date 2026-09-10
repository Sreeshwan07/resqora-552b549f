/**
 * Accessible, mobile-friendly form fields with inline validation messages.
 *
 * These wrap the existing shadcn Input/Textarea/Select so screens keep their
 * current look, while every error is announced next to its field (never only in
 * a toast) and phone fields physically cannot hold more than 10 digits.
 */
import { useId } from "react";
import { AlertCircle } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import { PHONE_DIAL_PREFIX, PHONE_MAX_LENGTH, toPhoneDigits } from "@/lib/validation";

export function FieldError({ id, message }: { id?: string; message?: string | null }) {
  if (!message) return null;
  return (
    <p
      id={id}
      role="alert"
      className="flex items-start gap-1.5 text-xs font-medium text-destructive"
    >
      <AlertCircle className="mt-0.5 size-3.5 shrink-0" aria-hidden="true" />
      <span>{message}</span>
    </p>
  );
}

type BaseProps = {
  label: string;
  value: string;
  onChange: (value: string) => void;
  onBlur?: () => void;
  error?: string | null;
  hint?: string;
  required?: boolean;
  id?: string;
  placeholder?: string;
  className?: string;
};

export function TextInputField({
  label,
  value,
  onChange,
  onBlur,
  error,
  hint,
  required,
  id,
  placeholder,
  type = "text",
  autoComplete,
  max,
  maxLength,
  className,
}: BaseProps & { type?: string; autoComplete?: string; max?: string; maxLength?: number }) {
  const generated = useId();
  const fieldId = id ?? `field-${generated}`;
  const errorId = `${fieldId}-error`;
  const hintId = `${fieldId}-hint`;
  return (
    <div className={cn("space-y-2", className)}>
      <Label htmlFor={fieldId}>
        {label}
        {required && (
          <span className="ml-0.5 text-destructive" aria-hidden="true">
            *
          </span>
        )}
      </Label>
      <Input
        id={fieldId}
        type={type}
        value={value}
        placeholder={placeholder}
        autoComplete={autoComplete}
        max={max}
        maxLength={maxLength}
        aria-required={required || undefined}
        aria-invalid={error ? true : undefined}
        aria-describedby={error ? errorId : hint ? hintId : undefined}
        onChange={(event) => onChange(event.target.value)}
        onBlur={onBlur}
        className={cn("h-11 rounded-xl", error && "border-destructive focus-visible:ring-destructive/40")}
      />
      {hint && !error && (
        <p id={hintId} className="text-xs text-muted-foreground">
          {hint}
        </p>
      )}
      <FieldError id={errorId} message={error} />
    </div>
  );
}

/**
 * Phone field: numeric keypad on mobile, digits only, hard-capped at 10.
 * Typing an 11th digit, pasting letters or pasting a +91 number all end up as
 * the same normalised 10-digit value. +91 stays a visual prefix.
 */
export function PhoneInputField({
  label,
  value,
  onChange,
  onBlur,
  error,
  hint,
  required,
  id,
  className,
  autoComplete = "tel-national",
}: BaseProps & { autoComplete?: string }) {
  const generated = useId();
  const fieldId = id ?? `phone-${generated}`;
  const errorId = `${fieldId}-error`;
  const hintId = `${fieldId}-hint`;
  return (
    <div className={cn("space-y-2", className)}>
      <Label htmlFor={fieldId}>
        {label}
        {required && (
          <span className="ml-0.5 text-destructive" aria-hidden="true">
            *
          </span>
        )}
      </Label>
      <div className="flex items-stretch">
        <span
          aria-hidden="true"
          className="inline-flex select-none items-center rounded-l-xl border border-r-0 border-input bg-muted px-3 text-sm text-muted-foreground"
        >
          {PHONE_DIAL_PREFIX}
        </span>
        <Input
          id={fieldId}
          type="tel"
          inputMode="numeric"
          pattern="[6-9][0-9]{9}"
          maxLength={PHONE_MAX_LENGTH}
          autoComplete={autoComplete}
          placeholder="9876543210"
          value={value}
          aria-required={required || undefined}
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? errorId : hint ? hintId : undefined}
          onChange={(event) => onChange(toPhoneDigits(event.target.value))}
          onPaste={(event) => {
            event.preventDefault();
            onChange(toPhoneDigits(event.clipboardData.getData("text")));
          }}
          onBlur={onBlur}
          className={cn(
            "h-11 rounded-l-none rounded-r-xl",
            error && "border-destructive focus-visible:ring-destructive/40",
          )}
        />
      </div>
      {hint && !error && (
        <p id={hintId} className="text-xs text-muted-foreground">
          {hint}
        </p>
      )}
      <FieldError id={errorId} message={error} />
    </div>
  );
}

export function TextAreaField({
  label,
  value,
  onChange,
  onBlur,
  error,
  hint,
  required,
  id,
  placeholder,
  rows = 3,
  className,
}: BaseProps & { rows?: number }) {
  const generated = useId();
  const fieldId = id ?? `area-${generated}`;
  const errorId = `${fieldId}-error`;
  return (
    <div className={cn("space-y-2", className)}>
      <Label htmlFor={fieldId}>
        {label}
        {required && (
          <span className="ml-0.5 text-destructive" aria-hidden="true">
            *
          </span>
        )}
      </Label>
      <Textarea
        id={fieldId}
        rows={rows}
        value={value}
        placeholder={placeholder}
        aria-required={required || undefined}
        aria-invalid={error ? true : undefined}
        aria-describedby={error ? errorId : undefined}
        onChange={(event) => onChange(event.target.value)}
        onBlur={onBlur}
        className={cn("rounded-xl", error && "border-destructive focus-visible:ring-destructive/40")}
      />
      {hint && !error && <p className="text-xs text-muted-foreground">{hint}</p>}
      <FieldError id={errorId} message={error} />
    </div>
  );
}
