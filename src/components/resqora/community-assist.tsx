import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { HandHeart, Loader2, Phone } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  VOLUNTEER_SKILLS,
  emergencyVolunteersQuery,
  requestVolunteerAssistance,
  skillLabels,
} from "@/lib/volunteers";

/**
 * Asks nearby *verified* volunteers for help on a live emergency. Matching,
 * eligibility and contact disclosure all happen server-side — this panel only
 * shows volunteers who really accepted.
 */
export function CommunityAssist({
  emergencyId,
  hasLocation,
}: {
  emergencyId: string;
  hasLocation: boolean;
}) {
  const queryClient = useQueryClient();
  const volunteers = useQuery(emergencyVolunteersQuery(emergencyId));
  const [skills, setSkills] = useState<string[]>([]);

  const request = useMutation({
    mutationFn: async () => requestVolunteerAssistance(emergencyId, skills),
    onSuccess: (result) => {
      if (result.reason === "no_location") {
        toast.error("Your location is not available yet, so nobody could be matched.");
      } else if (result.offered === 0) {
        toast.info("No verified volunteers are available nearby right now.");
      } else {
        toast.success(`${result.offered} nearby volunteer(s) were asked to help.`);
      }
      void queryClient.invalidateQueries({ queryKey: ["emergency-volunteers", emergencyId] });
    },
    onError: (error: Error) => toast.error(error.message),
  });

  const accepted = (volunteers.data ?? []).filter(
    (v) => v.status === "accepted" || v.status === "completed",
  );
  const pending = (volunteers.data ?? []).filter((v) => v.status === "offered");

  return (
    <div className="glass-panel space-y-4 rounded-2xl p-5">
      <div className="flex items-center gap-2">
        <HandHeart className="size-4 text-primary" aria-hidden="true" />
        <h2 className="text-sm font-semibold text-foreground">Community assistance</h2>
      </div>
      <p className="text-xs text-muted-foreground">
        Verified volunteers close to you can be asked to help while professional responders are on
        their way. They only see your exact location after accepting.
      </p>

      <div className="flex flex-wrap gap-2">
        {VOLUNTEER_SKILLS.slice(0, 6).map((skill) => {
          const on = skills.includes(skill.value);
          return (
            <button
              key={skill.value}
              type="button"
              aria-pressed={on}
              onClick={() =>
                setSkills((s) =>
                  s.includes(skill.value) ? s.filter((x) => x !== skill.value) : [...s, skill.value],
                )
              }
              className={`rounded-full border px-3 py-1 text-xs font-medium transition-colors ${
                on
                  ? "border-primary bg-primary text-primary-foreground"
                  : "border-border text-muted-foreground hover:bg-muted/60"
              }`}
            >
              {skill.label}
            </button>
          );
        })}
      </div>

      <Button
        className="w-full"
        onClick={() => request.mutate()}
        disabled={request.isPending || !hasLocation}
      >
        {request.isPending && <Loader2 className="mr-2 size-4 animate-spin" aria-hidden="true" />}
        Ask nearby volunteers for help
      </Button>
      {!hasLocation && (
        <p className="text-xs text-muted-foreground">
          Waiting for your location — volunteers are matched by distance.
        </p>
      )}

      {accepted.length > 0 && (
        <ul className="space-y-2">
          {accepted.map((v) => (
            <li
              key={v.match_id}
              className="flex items-center justify-between gap-3 rounded-xl border border-border p-3"
            >
              <div className="min-w-0">
                <p className="truncate text-sm font-semibold text-foreground">{v.volunteer_name}</p>
                <p className="truncate text-xs text-muted-foreground">
                  {skillLabels(v.skills).join(", ") || "Volunteer"}
                  {v.distance_km != null ? ` · ${v.distance_km} km away` : ""}
                </p>
              </div>
              <div className="flex shrink-0 items-center gap-2">
                <Badge variant={v.status === "completed" ? "secondary" : "default"}>
                  {v.status === "completed" ? "Helped" : "On the way"}
                </Badge>
                {v.volunteer_phone && (
                  <Button size="icon" variant="outline" asChild>
                    <a href={`tel:${v.volunteer_phone}`} aria-label={`Call ${v.volunteer_name}`}>
                      <Phone className="size-4" aria-hidden="true" />
                    </a>
                  </Button>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}

      {pending.length > 0 && (
        <p className="text-xs text-muted-foreground">
          {pending.length} volunteer(s) asked — waiting for someone to accept.
        </p>
      )}
    </div>
  );
}
