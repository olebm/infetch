import { type NextRequest, NextResponse } from "next/server";
import { updateSupabaseSession } from "@/lib/supabase/middleware";

// ── Hostname-Routing ──────────────────────────────────────────────────────────
// infetch.de / www.infetch.de  → Landing Page
// app.infetch.de               → App (Auth-geschützt)
// localhost / *.vercel.app     → Wie app.infetch.de (lokale Entwicklung)

const LANDING_HOSTNAMES = ["infetch.de", "www.infetch.de"];
const APP_HOSTNAME = "app.infetch.de";

// Pfade, die auch auf der Landing-Domain ausgeliefert werden
const LANDING_ALLOWED_PREFIXES = [
  "/landingpage",
  "/agb",
  "/datenschutz",
  "/impressum",
  "/avv",
  "/changelog",
  "/ueber-uns",
  "/auth",            // /auth/callback — falls Magic Link auf infetch.de landet
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

  // Behind Coolify / Traefik the real hostname is forwarded via headers.
  // Priority: x-forwarded-host → host → nextUrl.hostname (internal fallback).
  const hostname = (
    request.headers.get("x-forwarded-host") ??
    request.headers.get("host") ??
    request.nextUrl.hostname
  ).split(":")[0].toLowerCase();

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
  // Supabase-Session in jedem Request refreshen (JWT-Rotation)
  const { response, userId } = await updateSupabaseSession(request);

  if (isPublicAppPath(pathname)) {
    return response;
  }

  // Kein eingeloggter User → zum Login umleiten
  if (!userId) {
    const loginUrl = request.nextUrl.clone();
    loginUrl.pathname = "/login";
    loginUrl.search = "";
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
