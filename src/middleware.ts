import { type NextRequest, NextResponse } from "next/server";
import { updateSupabaseSession } from "@/lib/supabase/middleware";

/**
 * Routen, die eine aktive Session erfordern.
 * Alle anderen Pfade (Login, Callback, Legal, API, Landingpage, …) sind öffentlich.
 */
const PROTECTED_PREFIXES = [
  "/audit",
  "/einstellungen",
  "/exports",
  "/fehlt",
  "/konto",
  "/online-accounts",
  "/senders",
  "/onboarding",
];

function isProtectedPath(pathname: string): boolean {
  if (pathname === "/") return true;
  return PROTECTED_PREFIXES.some((prefix) => pathname === prefix || pathname.startsWith(prefix + "/"));
}

/**
 * Externen Origin reverse-proxy-sicher bestimmen.
 *
 * Hinter Coolify/nginx zeigt request.url/nextUrl auf die interne Adresse
 * (0.0.0.0:3000). Ein darauf basierender Redirect schickt den Browser ins
 * Leere ("This page couldn't load"). Daher x-forwarded-* bevorzugen —
 * identisch zur bewährten Logik in src/app/auth/callback/route.ts.
 */
function externalOrigin(request: NextRequest): string {
  const forwardedHost = request.headers.get("x-forwarded-host");
  const forwardedProto = request.headers.get("x-forwarded-proto") ?? "https";
  if (forwardedHost) return `${forwardedProto}://${forwardedHost}`;
  const host = request.headers.get("host");
  if (host) return `${forwardedProto}://${host}`;
  return request.nextUrl.origin;
}

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // Supabase-Session in jedem Request refreshen (Cookie-Rotation).
  // Bei einem Supabase-Ausfall NICHT die gesamte Seite mit 500 beantworten:
  // Session-Refresh überspringen, Page-level getCurrentAuth() bleibt als
  // zweite Verteidigungslinie.
  let result: { response: NextResponse; userId: string | null };
  try {
    result = await updateSupabaseSession(request);
  } catch {
    return NextResponse.next({ request });
  }

  if (isProtectedPath(pathname) && !result.userId) {
    const loginUrl = new URL("/login", externalOrigin(request));
    // next-Parameter setzen, damit nach dem Login zurück navigiert wird —
    // außer bei der Root-Route, die ist der Default-Landing-Ort.
    if (pathname !== "/") {
      loginUrl.searchParams.set("next", pathname);
    }
    return NextResponse.redirect(loginUrl);
  }

  return result.response;
}

export const config = {
  matcher: [
    // Nur Seiten-Navigationen. Ausgenommen: /api (eigene Auth bzw. Webhooks),
    // Next.js-Interna und statische Assets.
    "/((?!api/|_next/static|_next/image|favicon\\.ico|images/|fonts/|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico|woff2?|ttf|otf)).*)",
  ],
};
