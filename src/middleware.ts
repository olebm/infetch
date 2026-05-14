import { type NextRequest, NextResponse } from "next/server";
import { updateSupabaseSession } from "@/lib/supabase/middleware";

const PUBLIC_PATH_PREFIXES = [
  "/login",
  "/logout",
  "/auth",            // /auth/callback Supabase-Redirect
  "/landingpage",
  "/onboarding",
  // Rechtliches / Info
  "/agb",
  "/datenschutz",
  "/impressum",
  "/avv",
  "/changelog",
  "/ueber-uns",
];

function isPublicPath(pathname: string): boolean {
  // Statische Dateien (jede Erweiterung) immer public
  if (/\.[a-z0-9]+$/i.test(pathname)) return true;
  return PUBLIC_PATH_PREFIXES.some(
    (prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`),
  );
}

export async function middleware(request: NextRequest) {
  const { pathname, search } = request.nextUrl;

  // Supabase-Session in jedem Request refreshen (JWT-Rotation)
  const { response, userId } = await updateSupabaseSession(request);

  if (isPublicPath(pathname)) {
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
  //   - Resend-Inbound-Webhook (api/inbound/*) — hat eigene HMAC-Signatur-Verifikation
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|api/invoice-files|api/ai|api/inbound).*)",
  ],
};
