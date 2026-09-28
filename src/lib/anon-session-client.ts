/**
 * Browser side of anonymous emergency sessions: when nobody is signed in, attach
 * a server-signed short-lived token to server-function calls. The token is opaque
 * and tamper-proof; editing it only invalidates it.
 */
import { createMiddleware } from "@tanstack/react-start";
import { supabase } from "@/integrations/supabase/client";
import { ANON_HEADER } from "@/lib/rate-limit-config";

const STORE = "resqora.anon-session";
let cached: { token: string; expiresAt: number } | null = null;
let pending: Promise<string | null> | null = null;

function fresh(entry: { expiresAt: number } | null) {
  return !!entry && entry.expiresAt * 1000 - Date.now() > 60_000;
}

async function getAnonToken(): Promise<string | null> {
  if (fresh(cached)) return cached!.token;
  try {
    const stored = JSON.parse(sessionStorage.getItem(STORE) ?? "null");
    if (fresh(stored)) {
      cached = stored;
      return stored.token;
    }
  } catch {
    /* ignore */
  }
  pending ??= fetch("/api/public/anon-session", { method: "POST" })
    .then(async (res) => {
      if (!res.ok) return null;
      const body = (await res.json()) as { token: string; expiresAt: number };
      cached = body;
      try {
        sessionStorage.setItem(STORE, JSON.stringify(body));
      } catch {
        /* ignore */
      }
      return body.token;
    })
    .catch(() => null)
    .finally(() => {
      pending = null;
    });
  return pending;
}

export const attachAnonSession = createMiddleware({ type: "function" }).client(async ({ next }) => {
  if (typeof window === "undefined") return next();
  const { data } = await supabase.auth.getSession();
  if (data.session) return next();
  const token = await getAnonToken();
  return next({ headers: token ? { [ANON_HEADER]: token } : {} });
});
