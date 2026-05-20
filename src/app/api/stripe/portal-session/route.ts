/**
 * POST /api/stripe/portal-session
 *
 * Erstellt eine Stripe Billing Portal Session und leitet dorthin weiter.
 * Nur für Nutzer mit einem aktiven Stripe-Abo (stripe_customer_id vorhanden).
 *
 * Nach dem Portal-Besuch kehrt der User zu /einstellungen zurück.
 */

import { NextRequest, NextResponse } from "next/server";
import { getCurrentAuth } from "@/lib/auth/current";
import { getStripeClient } from "@/lib/stripe";
import { unsafeGlobalSql as sql } from "@/lib/db/unsafe-global";

export const dynamic = "force-dynamic";

// SECURITY: Wie /api/stripe/checkout — fest verdrahtete Allowlist gegen Host-Header-Injection.
const ALLOWED_STRIPE_HOSTS = new Set(["app.infetch.de", "infetch.de", "localhost", "127.0.0.1"]);
const FALLBACK_BASE = "https://app.infetch.de";

function getBaseUrl(request: NextRequest): string {
  const configured = process.env.NEXT_PUBLIC_APP_URL?.trim();
  if (configured) return configured.replace(/\/$/, "");

  const proto = (request.headers.get("x-forwarded-proto") ?? "https").split(",")[0]!.trim();
  const rawHost = (
    request.headers.get("x-forwarded-host") ??
    request.headers.get("host") ??
    ""
  ).split(",")[0]!.trim();

  // SECURITY: URL-Parser benutzen — split(":")[0] würde
  // `app.infetch.de:80@malicious.com` als "app.infetch.de" akzeptieren,
  // der Browser interpretiert die volle URL aber als malicious.com (userinfo).
  let parsedHost: string;
  try {
    parsedHost = new URL(`http://${rawHost}`).host;
  } catch {
    return FALLBACK_BASE;
  }
  const hostname = parsedHost.split(":")[0]!.toLowerCase();
  if (!ALLOWED_STRIPE_HOSTS.has(hostname)) return FALLBACK_BASE;
  return `${proto}://${parsedHost}`;
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  // ── Auth-Check ───────────────────────────────────────────────────────────────
  const auth = await getCurrentAuth();
  if (!auth?.user?.id || !auth?.organization?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const orgId = auth.organization.id;

  // ── stripe_customer_id laden ──────────────────────────────────────────────────
  let stripeCustomerId: string | null = null;
  try {
    const rows = await sql<{ stripe_customer_id: string | null }[]>`
      SELECT stripe_customer_id FROM organizations WHERE id = ${orgId} LIMIT 1
    `;
    stripeCustomerId = rows[0]?.stripe_customer_id ?? null;
  } catch (err) {
    console.error("[stripe/portal-session] DB-Fehler:", err);
    return NextResponse.json({ error: "Datenbankfehler." }, { status: 500 });
  }

  if (!stripeCustomerId) {
    return NextResponse.json(
      { error: "Kein Stripe-Abo gefunden. Bitte zuerst ein Upgrade durchführen." },
      { status: 400 },
    );
  }

  // ── Billing Portal Session erstellen ─────────────────────────────────────────
  try {
    const stripe = getStripeClient();
    const base = getBaseUrl(request);

    const session = await stripe.billingPortal.sessions.create({
      customer: stripeCustomerId,
      return_url: `${base}/einstellungen`,
    });

    return NextResponse.redirect(session.url, { status: 303 });
  } catch (err) {
    console.error("[stripe/portal-session] Fehler:", err);
    return NextResponse.json(
      { error: "Billing Portal konnte nicht geöffnet werden." },
      { status: 500 },
    );
  }
}
