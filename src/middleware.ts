import { NextResponse, type NextRequest } from "next/server";

const SESSION_COOKIE_NAME = "ia_session";

const PUBLIC_PATH_PREFIXES = [
  "/login",
  "/logout",
  "/landingpage",
  "/onboarding",
  // Public info / legal pages
  "/agb",
  "/datenschutz",
  "/impressum",
  "/avv",
  "/changelog",
  "/ueber-uns",
];

function isPublicPath(pathname: string): boolean {
  // Static files (any extension) are always public
  if (/\.[a-z0-9]+$/i.test(pathname)) return true;
  return PUBLIC_PATH_PREFIXES.some(
    (prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`),
  );
}

export function middleware(request: NextRequest) {
  const { pathname, search } = request.nextUrl;

  if (isPublicPath(pathname)) {
    return NextResponse.next();
  }

  const hasSession = Boolean(request.cookies.get(SESSION_COOKIE_NAME)?.value);
  if (hasSession) {
    return NextResponse.next();
  }

  const loginUrl = request.nextUrl.clone();
  loginUrl.pathname = "/login";
  loginUrl.search = "";
  if (pathname !== "/") {
    loginUrl.searchParams.set("next", `${pathname}${search}`);
  }
  return NextResponse.redirect(loginUrl);
}

export const config = {
  // Auth-Middleware nicht anwenden auf:
  //   - statische Assets (_next/*)
  //   - PDF-Preview-iframe (api/invoice-files)
  //   - AI-Proxy-Endpoint (api/ai/*) — hat eigene Bearer-Auth
  //   - Resend-Inbound-Webhook (api/inbound/*) — hat eigene HMAC-Signatur-Verifikation
  matcher: ["/((?!_next/static|_next/image|favicon.ico|api/invoice-files|api/ai|api/inbound).*)"],
};
