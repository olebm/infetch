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
  return PROTECTED_PREFIXES.some((prefix) => pathname.startsWith(prefix + "/") || pathname === prefix);
}

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // Supabase-Session in jedem Request refreshen (Cookie-Rotation).
  const { response, userId } = await updateSupabaseSession(request);

  if (isProtectedPath(pathname) && !userId) {
    const loginUrl = new URL("/login", request.url);
    // next-Parameter setzen, damit nach dem Login zurück navigiert wird —
    // außer bei der Root-Route, die ist der Default-Landing-Ort.
    if (pathname !== "/") {
      loginUrl.searchParams.set("next", pathname);
    }
    return NextResponse.redirect(loginUrl);
  }

  return response;
}

export const config = {
  matcher: [
    // Alle Routen außer Next.js-Interna und statische Assets.
    "/((?!_next/static|_next/image|favicon\\.ico|images/|fonts/|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico|woff2?|ttf|otf)).*)",
  ],
};
