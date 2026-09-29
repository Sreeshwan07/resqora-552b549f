import { createFileRoute } from "@tanstack/react-router";

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", "cache-control": "no-store" },
  });

/** Mints a signed, short-lived anonymous session for low-friction emergency AI/Maps use. */
export const Route = createFileRoute("/api/public/anon-session")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const { issueAnonToken, shortHash, trustedClientIp } =
          await import("@/lib/anon-session.server");
        const { consumeRaw, GuardError } = await import("@/lib/paid-guard.server");
        const { ANON_ISSUE_LIMIT, GUARD_MESSAGES } = await import("@/lib/rate-limit-config");
        try {
          const ip = trustedClientIp(request) ?? "untrusted-network";
          const limit = await consumeRaw(
            `ip:${await shortHash(ip)}`,
            "anon-session-issue",
            ANON_ISSUE_LIMIT.windowSeconds,
            ANON_ISSUE_LIMIT.max,
          );
          if (!limit.allowed) return json({ error: GUARD_MESSAGES[429] }, 429);
          return json(await issueAnonToken());
        } catch (error) {
          const status = error instanceof GuardError ? error.status : 503;
          return json({ error: GUARD_MESSAGES[status as 503] ?? GUARD_MESSAGES[503] }, status);
        }
      },
    },
  },
});
