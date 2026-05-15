/**
 * POST /api/stripe/checkout
 *
 * Erstellt eine Stripe Checkout Session für den angegebenen Plan und leitet
 * den Browser direkt zu Stripe weiter (303 Redirect).
 *
 * Body (JSON):
 *   { target: "pro" }
 *
 * Benötigte Env-Variablen:
 *   STRIPE_SECRET_KEY      — Secret key aus Stripe Dashboard
 *   STRIPE_PRICE_ID_PRO    — Price ID des monatlichen Pro-Plans
 *
 * Nach erfolgreichem Checkout:
 *   → /einstellungen?checkout=success
 * Bei Abbruch:
 *   → /einstellungen?checkout=canceled
 */

import { NextRequest, NextResponse } from "next/server";
import { getCurrentAuth } from "@/lib/auth/current";
import { getStripeClient, isStripeConfigured } from "@/lib/stripe";
import { appConfig } from "@/lib/config/env";
import { sql } from "@/lib/db/client";

export const dynamic = "force-dynamic";

// SECURITY: NEXT_PUBLIC_APP_URL bevorzugt — verhindert Host-Header-Injection,
// die Stripe-Success/Cancel-Redirects auf eine Angreifer-Domain umlenken könnte.
const ALLOWED_STRIPE_HOSTS = new Set(["app.infetch.de", "infetch.de", "localhost", "127.0.0.1"]);

function getBaseUrl(request: NextRequest): string {
  const configured = process.env.NEXT_PUBLIC_APP_URL?.trim();
  if (configured) return configured.replace(/\/$/, "");

  const proto = (request.headers.get("x-forwarded-proto") ?? "https").split(",")[0]!.trim();
  const rawHost = (
    request.headers.get("x-forwarded-host") ??
    request.headers.get("host") ??
    "app.infetch.de"
  ).split(",")[0]!.trim();
  const hostname = rawHost.split(":")[0]!.toLowerCase();
  const host = ALLOWED_STRIPE_HOSTS.has(hostname) ? rawHost : "app.infetch.de";
  return `${proto}://${host}`;
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  // ── Auth-Check ───────────────────────────────────────────────────────────────
  const auth = await getCurrentAuth();
  if (!auth?.user?.id || !auth?.organization?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // ── Stripe konfiguriert? ─────────────────────────────────────────────────────
  if (!isStripeConfigured()) {
    return NextResponse.json(
      { error: "Stripe ist nicht konfiguriert." },
      { status: 503 },
    );
  }

  const priceId = appConfig.stripe.priceIdPro;
  if (!priceId) {
    return NextResponse.json(
      { error: "STRIPE_PRICE_ID_PRO fehlt." },
      { status: 503 },
    );
  }

  const orgId = auth.organization.id;
  const userEmail = auth.user.email ?? undefined;
  const base = getBaseUrl(request);

  // ── Vorhandene Stripe-Customer-ID laden (falls vorhanden) ────────────────────
  let stripeCustomerId: string | null = null;
  try {
    const rows = await sql<{ stripe_customer_id: string | null }[]>`
      SELECT stripe_customer_id FROM organizations WHERE id = ${orgId} LIMIT 1
    `;
    stripeCustomerId = rows[0]?.stripe_customer_id ?? null;
  } catch {
    // Non-fatal — ohne customer_id geht es auch
  }

  // ── Checkout Session erstellen ────────────────────────────────────────────────
  try {
    const stripe = getStripeClient();

    const session = await stripe.checkout.sessions.create({
      mode: "subscription",
      line_items: [{ price: priceId, quantity: 1 }],
      // Bekannter Customer → Daten vorausfüllen
      ...(stripeCustomerId
        ? { customer: stripeCustomerId }
        : userEmail
          ? { customer_email: userEmail }
          : {}),
      // organization_id in Metadata → Webhook kann die Org updaten
      metadata: { organization_id: orgId },
      // Billing Address und Steuer-ID abfragen (für Stripe Tax / B2B)
      billing_address_collection: "required",
      tax_id_collection: { enabled: true },
      // Automatic Tax — erfordert im Dashboard aktiviertes Stripe Tax
      automatic_tax: { enabled: true },
      success_url: `${base}/einstellungen?checkout=success`,
      cancel_url: `${base}/einstellungen?checkout=canceled`,
      // Erlaubt promo codes falls welche hinterlegt
      allow_promotion_codes: true,
    });

    if (!session.url) {
      throw new Error("Checkout Session URL fehlt.");
    }

    return NextResponse.redirect(session.url, { status: 303 });
  } catch (err) {
    console.error("[stripe/checkout] Fehler:", err);
    return NextResponse.json(
      { error: "Checkout Session konnte nicht erstellt werden." },
      { status: 500 },
    );
  }
}
