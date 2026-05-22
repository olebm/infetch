import { type NextRequest, NextResponse } from "next/server";
import { updateSupabaseSession } from "@/lib/supabase/middleware";
import { apiIpLimiter, clientIpFromHeaders } from "@/lib/rate-limit";

// Endpunkte mit eigener Auth bzw. eigenem Limiter — vom globalen API-Limit
// ausgenommen (Webhooks/Cron werden von externen Diensten in Bursts gerufen).
const RATE_LIMIT_EXEMPT_PREFIXES = [
  "/api/stripe/webhook",
  "/api/sentry-webhook",
  "/api/cron",
  "/api/ai",
  "/api/inbound",
  "/api/contact",
  "/api/csp-report",
  "/api/test",
];

const MUTATING_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"]);

// ── Hostname-Routing ──────────────────────────────────────────────────────────
// infetch.de / www.infetch.de  → Landing Page
// app.infetch.de               → App (Auth-geschützt)
// localhost / *.vercel.app     → Wie app.infetch.de (lokale Entwicklung)

const LANDING_HOSTNAMES = ["infetch.de", "www.infetch.de"];
const _DEV_HOSTNAMES = ["localhost", "127.0.0.1"];
const APP_HOSTNAME = "app.infetch.de";

// Pfade, die auch auf der Landing-Domain ausgeliefert werden
const LANDING_ALLOWED_PREFIXES = [
  "/landingpage",
  "/blog",            // Blog — öffentlich, muss same-origin bleiben (RSC-Navigation)
  "/agb",
  "/datenschutz",
  "/impressum",
  "/avv",
  "/changelog",
  "/ueber-uns",
  "/auth",            // /auth/callback — falls Magic Link auf infetch.de landet
  "/api/csp-report",  // Browser postet CSP-Violations — kein Redirect bei POST erlaubt
];

// ── App-Domain: öffentliche Pfade (kein Auth nötig) ───────────────────────────
const APP_PUBLIC_PREFIXES = [
  "/login",
  "/logout",
  "/auth",
  "/landingpage",
  "/onboarding",
  "/agb",
  "/datenschutz",
  "/impressum",
  "/avv",
  "/changelog",
  "/ueber-uns",
  "/api/test", // Test-Endpunkte (nur aktiv wenn ENABLE_TEST_LOGIN=true in der Route)
  "/api/csp-report", // CSP-Telemetrie (Browser sendet ohne Auth/Cookies)
  "/api/health", // Liveness für Coolify/Traefik — kein Auth, sonst 307 statt 200
  "/api/sentry-webhook", // Glitchtip Webhook — externer Dienst, kein Auth möglich
];

function isPublicAppPath(pathname: string): boolean {
  if (/\.[a-z0-9]+$/i.test(pathname)) return true;
  return APP_PUBLIC_PREFIXES.some(
    (prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`),
  );
}

function matchesPrefix(pathname: string, prefixes: string[]): boolean {
  return prefixes.some(
    (p) => pathname === p || pathname.startsWith(`${p}/`),
  );
}

export async function proxy(request: NextRequest) {
  const { pathname, search } = request.nextUrl;

  // Behind Coolify / Traefik the real host is forwarded via headers.
  // Priority: x-forwarded-host → host → nextUrl.host (internal fallback).
  // forwardedHost keeps any non-standard port (needed for redirects on
  // local/dev or proxied non-443 setups); hostname is the port-stripped,
  // lowercased form used only for domain-class comparison.
  const forwardedHost =
    request.headers.get("x-forwarded-host") ??
    request.headers.get("host") ??
    request.nextUrl.host;
  const hostname = forwardedHost.split(":")[0].toLowerCase();

  // ── Landing-Domain Routing ─────────────────────────────────────────────────
  if (LANDING_HOSTNAMES.includes(hostname)) {
    // Statische Assets immer durchlassen
    if (/\.[a-z0-9]+$/i.test(pathname)) return NextResponse.next();

    // Root "/" → Landingpage
    if (pathname === "/") {
      const url = request.nextUrl.clone();
      url.pathname = "/landingpage";
      return NextResponse.rewrite(url);
    }

    // Erlaubte Landing-Pfade → durchlassen
    if (matchesPrefix(pathname, LANDING_ALLOWED_PREFIXES)) {
      return NextResponse.next();
    }

    // Alles andere auf der Root-Domain → weiterleiten zu app.infetch.de
    const appUrl = new URL(`https://${APP_HOSTNAME}${pathname}${search}`);
    return NextResponse.redirect(appUrl, { status: 302 });
  }

  // ── App-Domain (app.infetch.de) + Lokale Entwicklung ─────────────────────

  // Globales Per-IP-Limit auf mutierende API-Requests (Brute-Force/DoS-Schutz).
  // Rein additiv: nur 429 bei Missbrauch, ändert sonst nichts am Auth-Flow.
  if (
    pathname.startsWith("/api/") &&
    MUTATING_METHODS.has(request.method) &&
    !matchesPrefix(pathname, RATE_LIMIT_EXEMPT_PREFIXES)
  ) {
    const verdict = apiIpLimiter.check(clientIpFromHeaders(request.headers));
    if (!verdict.ok) {
      const retryAfter = Math.max(1, Math.ceil((verdict.resetAt - Date.now()) / 1000));
      return NextResponse.json(
        { error: "rate_limited" },
        { status: 429, headers: { "retry-after": String(retryAfter) } },
      );
    }
  }

  // Supabase-Session in jedem Request refreshen (JWT-Rotation).
  // Bei einem Supabase-Ausfall NICHT die gesamte Seite mit 500 beantworten:
  // Session-Refresh überspringen, Page-level getCurrentAuth() bleibt als
  // zweite Verteidigungslinie.
  let sessionResult: { response: NextResponse; userId: string | null };
  try {
    sessionResult = await updateSupabaseSession(request);
  } catch {
    return NextResponse.next({ request });
  }
  const { response, userId } = sessionResult;

  if (isPublicAppPath(pathname)) {
    return response;
  }

  // Kein eingeloggter User → zum Login umleiten.
  // request.nextUrl.clone() würde hinter Coolify/Traefik auf die interne
  // Docker-Adresse zeigen (http://0.0.0.0:3000). Daher x-forwarded-* nutzen —
  // identisch zur bewährten Logik in src/app/auth/callback/route.ts.
  if (!userId) {
    const proto = request.headers.get("x-forwarded-proto") ?? "https";
    const loginUrl = new URL(`${proto}://${forwardedHost}/login`);
    if (pathname !== "/") {
      loginUrl.searchParams.set("next", `${pathname}${search}`);
    }
    return NextResponse.redirect(loginUrl);
  }

  return response;
}

export const config = {
  // Middleware nicht anwenden auf:
  //   - statische Assets (_next/*)
  //   - PDF-Preview-iframe (api/invoice-files)
  //   - AI-Proxy-Endpoint (api/ai/*) — hat eigene Bearer-Auth
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|api/invoice-files|api/ai).*)",
  ],
};
