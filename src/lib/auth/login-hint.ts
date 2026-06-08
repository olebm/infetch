import type { NextResponse } from "next/server";

/**
 * Nicht-sensibler „Login-Hinweis" für die Marketing-Domain.
 *
 * Hintergrund: Die echte Supabase-Session ist ein host-only Cookie auf
 * `app.infetch.de`. Die öffentliche Landingpage auf `infetch.de` kann sie
 * darum nicht lesen und wüsste sonst nie, ob der Besucher eingeloggt ist
 * (der Header zeigte dauerhaft „Anmelden" statt „Übersicht").
 *
 * Dieses Cookie schließt genau diese Lücke — und NUR diese: Es ist ein Flag,
 * domainübergreifend auf `.infetch.de` sichtbar, das sagt „dieser Browser ist
 * eingeloggt". Es enthält KEIN Token, keine Session, keine Berechtigung.
 *
 * Sicherheit: Ein gefälschtes/veraltetes Cookie ändert ausschließlich den
 * Button-Text. Jeder geschützte Pfad prüft weiterhin die echte Session
 * (siehe `proxy.ts` + `getCurrentAuth`); „Übersicht" führt auf `/`, wo das
 * Auth-Gate greift. Die echte Sitzung bleibt unverändert host-only auf der
 * App-Domain.
 */
export const LOGIN_HINT_COOKIE = "if_auth";

// 30 Tage. Wird bei jedem eingeloggten App-Request refresht (siehe
// `syncLoginHintCookie` in der Middleware), läuft also nur nach längerer
// Inaktivität ab — dann zeigt der Header wieder „Anmelden", was korrekt ist.
const LOGIN_HINT_MAX_AGE = 60 * 60 * 24 * 30;

/**
 * Wählt die Cookie-Domain so, dass `infetch.de` UND `app.infetch.de` denselben
 * Hinweis sehen. Lokal/Preview (localhost, 127.0.0.1, *.vercel.app) → host-only
 * (undefined), damit der Hinweis dort same-origin trotzdem funktioniert und
 * der Browser ein `.infetch.de`-Cookie nicht als ungültig verwirft.
 */
export function getLoginHintDomain(hostname: string): string | undefined {
  if (hostname === "infetch.de" || hostname.endsWith(".infetch.de")) {
    return ".infetch.de";
  }
  return undefined;
}

/**
 * Hält das Hinweis-Cookie synchron zur echten Session: gesetzt bei
 * eingeloggtem `userId`, sonst entfernt. Schreibt auf die übergebene Response
 * (Middleware-Kontext). `hostname` ist bereits port-bereinigt und lowercase.
 */
export function syncLoginHintCookie(
  response: NextResponse,
  hostname: string,
  userId: string | null,
): void {
  const domain = getLoginHintDomain(hostname);
  // Echte infetch.de-Domains laufen über HTTPS; lokal (http) muss secure aus
  // bleiben, sonst setzt der Browser das Cookie nicht.
  const secure = domain !== undefined;
  response.cookies.set(LOGIN_HINT_COOKIE, userId ? "1" : "", {
    domain,
    path: "/",
    httpOnly: true,
    sameSite: "lax",
    secure,
    maxAge: userId ? LOGIN_HINT_MAX_AGE : 0,
  });
}
