import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  Outlet,
  Link,
  createRootRouteWithContext,
  useRouter,
  HeadContent,
  Scripts,
} from "@tanstack/react-router";
import { useEffect, type ReactNode } from "react";

import appCss from "../styles.css?url";
import { reportLovableError } from "../lib/lovable-error-reporting";
import { ThemeProvider } from "@/context/theme-context";
import { AuthProvider } from "@/context/auth-context";
import { Toaster } from "@/components/ui/sonner";
import { registerServiceWorker } from "@/lib/register-sw";
import { LaunchSplash } from "@/components/pwa/launch-splash";

/**
 * iOS/iPadOS has no manifest splash — Safari only honours
 * `apple-touch-startup-image` matched by exact device metrics, so each supported
 * screen gets its own pre-rendered file with the untouched RESQORA logo centred
 * on the same light field the in-app splash uses.
 */
const IOS_LAUNCH_SCREENS: Array<{ w: number; h: number; dpr: number }> = [
  { w: 375, h: 667, dpr: 2 },
  { w: 414, h: 896, dpr: 2 },
  { w: 375, h: 812, dpr: 3 },
  { w: 390, h: 844, dpr: 3 },
  { w: 393, h: 852, dpr: 3 },
  { w: 428, h: 926, dpr: 3 },
  { w: 430, h: 932, dpr: 3 },
  { w: 768, h: 1024, dpr: 2 },
  { w: 810, h: 1080, dpr: 2 },
  { w: 834, h: 1194, dpr: 2 },
  { w: 1024, h: 1366, dpr: 2 },
];

const iosLaunchImageLinks = IOS_LAUNCH_SCREENS.map(({ w, h, dpr }) => ({
  rel: "apple-touch-startup-image",
  href: `/brand/splash-${w * dpr}x${h * dpr}.jpg`,
  media: `screen and (device-width: ${w}px) and (device-height: ${h}px) and (-webkit-device-pixel-ratio: ${dpr}) and (orientation: portrait)`,
}));

function NotFoundComponent() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="max-w-md text-center">
        <h1 className="text-7xl font-bold text-foreground">404</h1>
        <h2 className="mt-4 text-xl font-semibold text-foreground">Page not found</h2>
        <p className="mt-2 text-sm text-muted-foreground">
          The page you're looking for doesn't exist or has been moved.
        </p>
        <div className="mt-6">
          <Link
            to="/"
            className="inline-flex items-center justify-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
          >
            Go home
          </Link>
        </div>
      </div>
    </div>
  );
}

function ErrorComponent({ error, reset }: { error: unknown; reset: () => void }) {
  console.error(error);
  const router = useRouter();
  useEffect(() => {
    reportLovableError(error, { boundary: "tanstack_root_error_component" });
  }, [error]);

  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="max-w-md text-center">
        <h1 className="text-xl font-semibold tracking-tight text-foreground">
          This page didn't load
        </h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Something went wrong on our end. You can try refreshing or head back home.
        </p>
        <div className="mt-6 flex flex-wrap justify-center gap-2">
          <button
            onClick={() => {
              router.invalidate();
              reset();
            }}
            className="inline-flex items-center justify-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
          >
            Try again
          </button>
          <a
            href="/"
            className="inline-flex items-center justify-center rounded-md border border-input bg-background px-4 py-2 text-sm font-medium text-foreground transition-colors hover:bg-accent"
          >
            Go home
          </a>
        </div>
      </div>
    </div>
  );
}

export const Route = createRootRouteWithContext<{ queryClient: QueryClient }>()({
  head: () => ({
    meta: [
      { charSet: "utf-8" },
      { name: "viewport", content: "width=device-width, initial-scale=1" },
      { title: "RESQORA — Emergency SOS" },
      {
        name: "description",
        content:
          "RESQORA puts one-tap SOS, AI accident reporting and the nearest hospital, police, fire and blood bank on a single emergency-ready screen.",
      },
      { name: "author", content: "RESQORA" },
      { property: "og:title", content: "RESQORA — Emergency SOS" },
      {
        property: "og:description",
        content:
          "RESQORA puts one-tap SOS, AI accident reporting and the nearest hospital, police, fire and blood bank on a single emergency-ready screen.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
      { name: "theme-color", content: "#e11d2f" },
      { name: "apple-mobile-web-app-capable", content: "yes" },
      { name: "apple-mobile-web-app-title", content: "RESQORA" },
      { name: "apple-mobile-web-app-status-bar-style", content: "default" },
      { name: "twitter:title", content: "RESQORA — Emergency SOS" },
      {
        name: "twitter:description",
        content:
          "RESQORA puts one-tap SOS, AI accident reporting and the nearest hospital, police, fire and blood bank on a single emergency-ready screen.",
      },
      {
        property: "og:image",
        content:
          "https://storage.googleapis.com/gpt-engineer-file-uploads/opgh28RpOwd9u5uojiAdEFLNH283/social-images/social-1785683216874-social-image.webp",
      },
      {
        name: "twitter:image",
        content:
          "https://storage.googleapis.com/gpt-engineer-file-uploads/opgh28RpOwd9u5uojiAdEFLNH283/social-images/social-1785683216874-social-image.webp",
      },
    ],
    links: [
      {
        rel: "stylesheet",
        href: appCss,
      },
      { rel: "manifest", href: "/manifest.webmanifest" },
      { rel: "preload", as: "image", href: "/brand/resqora-logo.webp", type: "image/webp" },
      { rel: "icon", type: "image/png", sizes: "32x32", href: "/favicon-32.png" },
      { rel: "icon", type: "image/png", sizes: "16x16", href: "/favicon-16.png" },
      { rel: "icon", type: "image/png", href: "/favicon.png" },
      { rel: "apple-touch-icon", href: "/icons/apple-touch-icon.png" },
      ...iosLaunchImageLinks,
      { rel: "preconnect", href: "https://fonts.googleapis.com" },
      { rel: "preconnect", href: "https://fonts.gstatic.com", crossOrigin: "anonymous" },
      {
        rel: "stylesheet",
        href: "https://fonts.googleapis.com/css2?family=Sora:wght@400;500;600;700;800&family=Manrope:wght@400;500;600;700&display=swap",
      },
    ],
  }),
  shellComponent: RootShell,
  component: RootComponent,
  notFoundComponent: NotFoundComponent,
  errorComponent: ErrorComponent,
});

function RootShell({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <head>
        <HeadContent />
      </head>
      <body>
        {children}
        <Scripts />
      </body>
    </html>
  );
}

function RootComponent() {
  const { queryClient } = Route.useRouteContext();

  useEffect(() => {
    registerServiceWorker();
  }, []);

  return (
    <QueryClientProvider client={queryClient}>
      <AuthProvider>
        <ThemeProvider>
          <LaunchSplash />
          {/* Required: nested routes render here. Removing <Outlet /> breaks all child routes. */}
          <Outlet />
          <Toaster position="bottom-center" richColors closeButton visibleToasts={3} />
        </ThemeProvider>
      </AuthProvider>
    </QueryClientProvider>
  );
}
