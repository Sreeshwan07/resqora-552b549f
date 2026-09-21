/**
 * HTTP security headers applied to every server response.
 *
 * The CSP is written for how RESQORA actually loads: Google Maps embeds and tiles,
 * the Lovable Cloud backend over HTTPS/WSS, and Google Fonts. Framing is limited
 * to this origin plus the Lovable editor preview so the app can still be
 * reviewed in-editor while remaining protected against clickjacking elsewhere.
 */
const CSP = [
  "default-src 'self'",
  "base-uri 'self'",
  "object-src 'none'",
  "form-action 'self'",
  // Vite's dev/HMR client and React Start's hydration payloads need inline eval.
  "script-src 'self' 'unsafe-inline' 'unsafe-eval' https://maps.googleapis.com https://maps.gstatic.com",
  "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
  "font-src 'self' data: https://fonts.gstatic.com",
  "img-src 'self' data: blob: https:",
  "media-src 'self' data: blob:",
  "connect-src 'self' https: wss:",
  "worker-src 'self' blob:",
  "manifest-src 'self'",
  "frame-src 'self' https://www.google.com https://maps.google.com https://www.google.com/maps/ https://www.openstreetmap.org",
  "frame-ancestors 'self' https://lovable.dev https://*.lovable.dev https://*.lovable.app https://*.lovableproject.com",
  "upgrade-insecure-requests",
].join("; ");

const PERMISSIONS_POLICY = [
  "geolocation=(self)",
  "camera=(self)",
  "microphone=(self)",
  "payment=()",
  "usb=()",
  "magnetometer=()",
  // Accident reports record device tilt alongside the photo evidence.
  "gyroscope=(self)",
  "interest-cohort=()",
].join(", ");

export function applySecurityHeaders(response: Response, request?: Request): Response {
  const headers = new Headers(response.headers);

  headers.set("Content-Security-Policy", CSP);
  headers.set("X-Content-Type-Options", "nosniff");
  headers.set("Referrer-Policy", "strict-origin-when-cross-origin");
  headers.set("Permissions-Policy", PERMISSIONS_POLICY);
  headers.set("Cross-Origin-Opener-Policy", "same-origin-allow-popups");
  headers.set("X-Permitted-Cross-Domain-Policies", "none");

  // frame-ancestors above governs embedding; X-Frame-Options has no allow-list
  // form, so it is only safe to send for responses that must never be framed.
  const url = request ? new URL(request.url) : null;
  if (url && url.protocol === "https:") {
    headers.set("Strict-Transport-Security", "max-age=31536000; includeSubDomains");
  }

  // Never let a token-bearing tracking page be cached by a shared proxy.
  if (url && /^\/(s|m|guardian)\//.test(url.pathname)) {
    headers.set("Cache-Control", "no-store, private");
    headers.set("Referrer-Policy", "no-referrer");
    headers.set("X-Robots-Tag", "noindex, nofollow");
  }

  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}
