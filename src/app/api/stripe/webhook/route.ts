/**
 * Stripe Webhook Handler
 *
 * Verarbeitet Checkout- und Subscription-Events von Stripe und aktualisiert
 * organizations.tier in Supabase Postgres.
 *
 * Einrichten:
 *   1. Stripe Dashboard → Webhooks → Endpoint hinzufügen
 *      URL: https://app.infetch.de/api/stripe/webhook
 *      Events: checkout.session.completed, customer.subscription.updated,
 *              customer.subscription.deleted
 *   2. Signing Secret als STRIPE_WEBHOOK_SECRET in Coolify setzen
 *   3. STRIPE_SECRET_KEY setzen (Secret key aus Developers → API Keys)
 *   4. STRIPE_PRICE_ID_PRO + STRIPE_PRICE_ID_BUSINESS auf deine Price IDs setzen
 *
 * Tier-Mapping:
 *   STRIPE_PRICE_ID_PRO      → "pro"
 *   STRIPE_PRICE_ID_BUSINESS → "business"
 *   Kündigung / unbekannt    → "free"
 */

import { NextRequest, NextResponse } from "next/server";
import type Stripe from "stripe";
import { appConfig } from "@/lib/config/env";
import { unsafeGlobalSql as sql } from "@/lib/db/unsafe-global";
import { getStripeClient, tierFromPriceId } from "@/lib/stripe";

export const dynamic = "force-dynamic";

function getStripe() {
  return getStripeClient();
}

// ── DB: org.tier aktualisieren via stripe_customer_id ────────────────────────

async function setOrgTierByCustomer(
  customerId: string,
  tier: "free" | "pro" | "business",
  eventTs: number,
): Promise<boolean> {
  // Out-of-Order-Schutz: nur anwenden, wenn dieses Event nicht älter ist als
  // das zuletzt verarbeitete. Ein verspätetes "updated(active)" nach einem
  // "deleted" wird so ignoriert (Tier-Flapping verhindert).
  const result = await sql`
    UPDATE organizations
    SET tier = ${tier}, stripe_event_ts = ${eventTs}, updated_at = NOW()
    WHERE stripe_customer_id = ${customerId}
      AND (stripe_event_ts IS NULL OR stripe_event_ts <= ${eventTs})
    RETURNING id
  `;
  return result.length > 0;
}

// ── DB: stripe_customer_id + org.tier nach Checkout setzen ───────────────────

async function handleCheckoutCompleted(
  session: Stripe.Checkout.Session,
  eventTs: number,
): Promise<void> {
  const customerId = typeof session.customer === "string" ? session.customer : session.customer?.id;
  const orgId = session.metadata?.organization_id;

  if (!customerId || !orgId) {
    console.warn("[stripe/webhook] checkout.session.completed: missing customer or org metadata", {
      customerId,
      orgId,
    });
    return;
  }

  // Tier aus Line Items / Subscription ermitteln
  let tier: "free" | "pro" | "business" = "free";

  if (session.subscription) {
    const stripe = getStripe();
    const sub = await stripe.subscriptions.retrieve(
      typeof session.subscription === "string" ? session.subscription : session.subscription.id,
    );
    const priceId = sub.items.data[0]?.price.id;
    tier = tierFromPriceId(priceId) ?? "free";
  }

  // Zuerst stripe_customer_id persistieren. stripe_event_ts als Basislinie
  // setzen, damit nachfolgende Subscription-Events korrekt geordnet werden.
  await sql`
    UPDATE organizations
    SET stripe_customer_id = ${customerId}, tier = ${tier},
        stripe_event_ts = ${eventTs}, updated_at = NOW()
    WHERE id = ${orgId}
  `;

  console.log(`[stripe/webhook] org ${orgId} → tier=${tier} (customer=${customerId})`);
}

// ── DB: Tier bei Subscription-Update anpassen ─────────────────────────────────

async function handleSubscriptionChanged(sub: Stripe.Subscription, eventTs: number): Promise<void> {
  const customerId = typeof sub.customer === "string" ? sub.customer : sub.customer.id;
  const priceId = sub.items.data[0]?.price.id;

  let tier: "free" | "pro" | "business";

  if (sub.status === "active" || sub.status === "trialing") {
    tier = tierFromPriceId(priceId) ?? "free";
  } else {
    // canceled, past_due, unpaid, etc. → downgrade auf Free
    tier = "free";
  }

  const updated = await setOrgTierByCustomer(customerId, tier, eventTs);
  if (!updated) {
    console.warn(
      `[stripe/webhook] subscription changed: no org found OR stale/out-of-order event for customer ${customerId}`,
    );
  } else {
    console.log(`[stripe/webhook] customer ${customerId} → tier=${tier} (status=${sub.status})`);
  }
}

// ── Route Handler ──────────────────────────────────────────────────────────────

export async function POST(request: NextRequest): Promise<NextResponse> {
  const webhookSecret = appConfig.stripe.webhookSecret;
  if (!webhookSecret) {
    console.error("[stripe/webhook] STRIPE_WEBHOOK_SECRET not configured");
    return NextResponse.json({ error: "webhook not configured" }, { status: 500 });
  }

  const body = await request.text();
  const signature = request.headers.get("stripe-signature");

  if (!signature) {
    return NextResponse.json({ error: "missing signature" }, { status: 400 });
  }

  let event: Stripe.Event;
  try {
    event = getStripe().webhooks.constructEvent(body, signature, webhookSecret);
  } catch (err) {
    console.error("[stripe/webhook] signature verification failed:", err);
    return NextResponse.json({ error: "invalid signature" }, { status: 400 });
  }

  // Idempotency: skip events already processed (duplicate delivery, retry storms).
  try {
    const inserted = await sql`
      INSERT INTO stripe_processed_events (event_id) VALUES (${event.id})
      ON CONFLICT (event_id) DO NOTHING
      RETURNING event_id
    `;
    if (inserted.length === 0) {
      console.log(`[stripe/webhook] duplicate event ${event.id} — skipping`);
      return NextResponse.json({ received: true, duplicate: true });
    }
  } catch (err) {
    console.error("[stripe/webhook] idempotency check failed:", err);
    // Non-fatal: continue processing — idempotent handlers are safe to re-run
  }

  // Stripe-Events tragen immer `created` (Unix-Sek.). Defensiver Fallback
  // auf "jetzt", falls ein Event ohne created ankommt (kein harter Fehler).
  const eventTs = typeof event.created === "number" ? event.created : Math.floor(Date.now() / 1000);

  try {
    switch (event.type) {
      case "checkout.session.completed":
        await handleCheckoutCompleted(event.data.object as Stripe.Checkout.Session, eventTs);
        break;

      case "customer.subscription.updated":
      case "customer.subscription.deleted":
        await handleSubscriptionChanged(event.data.object as Stripe.Subscription, eventTs);
        break;

      default:
        // Unbekannte Events still ignorieren
        break;
    }
  } catch (err) {
    console.error(`[stripe/webhook] error handling ${event.type}:`, err);
    // 200 zurückgeben damit Stripe nicht re-tried — der Fehler wird in Sentry geloggt
    return NextResponse.json({ error: "handler error" }, { status: 200 });
  }

  return NextResponse.json({ received: true });
}
