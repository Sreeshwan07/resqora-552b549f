<!-- LOVABLE:BEGIN -->
> [!IMPORTANT]
> This project is connected to [Lovable](https://lovable.dev). Avoid rewriting
> published git history — force pushing, or rebasing/amending/squashing commits
> that are already pushed — as it rewrites history on Lovable's side and the
> user will likely lose their project history.
>
> Commits you push to the connected branch sync back to Lovable and show up in
> the editor, so keep the branch in a working state.
<!-- LOVABLE:END -->

## Architecture rules
- Paid AI/Maps server functions must call `guardPaidEndpoint(<name>)` (src/lib/paid-guard.server.ts) before any provider call; limits live only in src/lib/rate-limit-config.ts — why: durable, atomic, per-user/per-signed-anon-session quotas that fail closed.
- Signed-out callers use server-signed short-lived anonymous tokens (`/api/public/anon-session`, header `x-resqora-anon`) — why: low-friction emergency access without trusting client IDs or forwarded IPs.
- Core SOS creation must never sit behind the paid-endpoint limiter — why: emergencies must work even when AI/Maps quotas are exhausted.
- Emergency email is sent only by the server (`requestEmergencyEmails` in src/lib/emergency-email.functions.ts; recipients come from saved contacts, rows deduped by `dedupe_key`; a database trigger blocks browser writes to email rows) — why: the browser must never be able to send or fake emergency emails.
- Every AI Gateway call goes through `callAiText` in src/lib/ai-call.server.ts (timeout, ≤1 retry on 5xx/network, size cap, safe error categories), and every structured result is checked with Zod via `parseAiJson`/`validateAi` before use — why: AI failure or malformed output must never break or mislead the emergency workflow.
