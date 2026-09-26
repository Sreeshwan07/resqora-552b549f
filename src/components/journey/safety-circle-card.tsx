import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { ShieldCheck, Star } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { useAuth } from "@/hooks/use-auth";
import { contactsQuery } from "@/lib/api";
import {
  removeFromSafetyCircle,
  safetyCircleQuery,
  setDefaultGuardian,
  upsertSafetyCircleMember,
} from "@/lib/safe-journey";

/**
 * Safety Circle — trusted contacts picked from the user's existing emergency
 * contacts. No duplicate contact records are ever created.
 */
export function SafetyCircleCard() {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const contacts = useQuery(contactsQuery(user?.id));
  const circle = useQuery(safetyCircleQuery(user?.id));
  const [busy, setBusy] = useState<string | null>(null);

  const refresh = () =>
    queryClient.invalidateQueries({ queryKey: ["safety-circle", user?.id] });

  const run = async (key: string, work: () => Promise<unknown>) => {
    setBusy(key);
    try {
      await work();
      await refresh();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not update your Safety Circle");
    } finally {
      setBusy(null);
    }
  };

  const members = circle.data ?? [];
  const rows = contacts.data ?? [];

  return (
    <section className="rounded-2xl border border-border bg-card p-4 sm:p-5">
      <h2 className="flex items-center gap-2 text-base font-semibold text-foreground">
        <ShieldCheck className="size-4 text-success" aria-hidden="true" />
        Safety Circle
      </h2>
      <p className="mt-1 text-sm text-muted-foreground">
        Choose which emergency contacts can watch your Safe Journeys, and what they are told.
      </p>

      {rows.length === 0 ? (
        <p className="mt-4 text-sm text-muted-foreground">
          Add an emergency contact first — your Safety Circle is chosen from that list.
        </p>
      ) : (
        <ul className="mt-4 space-y-3">
          {rows.map((contact) => {
            const member = members.find((entry) => entry.contact_id === contact.id);
            return (
              <li key={contact.id} className="rounded-xl border border-border p-3">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-semibold text-foreground">
                      {contact.name}
                      {member?.is_default_guardian && (
                        <span className="ml-2 inline-flex items-center gap-1 rounded-full bg-success/15 px-2 py-0.5 text-[11px] font-medium text-success">
                          <Star className="size-3" aria-hidden="true" />
                          Default guardian
                        </span>
                      )}
                    </p>
                    <p className="truncate text-xs text-muted-foreground">
                      {contact.relationship} · {contact.phone}
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    {member && !member.is_default_guardian && (
                      <Button
                        size="sm"
                        variant="outline"
                        className="min-h-10"
                        disabled={busy !== null}
                        onClick={() =>
                          void run(contact.id, () =>
                            setDefaultGuardian(user?.id ?? "", contact.id),
                          )
                        }
                      >
                        Make default
                      </Button>
                    )}
                    <Button
                      size="sm"
                      variant={member ? "ghost" : "default"}
                      className="min-h-10"
                      disabled={busy !== null}
                      onClick={() =>
                        void run(contact.id, () =>
                          member
                            ? removeFromSafetyCircle(user?.id ?? "", contact.id)
                            : upsertSafetyCircleMember(user?.id ?? "", contact.id, {}),
                        )
                      }
                    >
                      {member ? "Remove" : "Add to circle"}
                    </Button>
                  </div>
                </div>

                {member && (
                  <div className="mt-3 space-y-2 border-t border-border pt-3">
                    {(
                      [
                        ["notify_on_start", "Tell them when a journey starts"],
                        ["notify_on_complete", "Tell them when I arrive safely"],
                        ["notify_on_missed", "Alert them if I miss a check-in"],
                      ] as const
                    ).map(([field, label]) => (
                      <label key={field} className="flex items-center justify-between gap-4 text-sm">
                        <span className="text-muted-foreground">{label}</span>
                        <Switch
                          checked={member[field]}
                          aria-label={label}
                          disabled={busy !== null}
                          onCheckedChange={(checked) =>
                            void run(`${contact.id}-${field}`, () =>
                              upsertSafetyCircleMember(user?.id ?? "", contact.id, {
                                [field]: checked,
                              }),
                            )
                          }
                        />
                      </label>
                    ))}
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
