/**
 * Stripe — Server-side client + helpers.
 *
 * Verwendung:
 *   import { getStripeClient, isStripeConfigured } from "@/lib/stripe";
 *   const stripe = getStripeClient();            // throws wenn STRIPE_SECRET_KEY fehlt
 *   const stripe = getStripeClientOrNull();     // null wenn nicht konfiguriert
 */

import Stripe from "stripe";
import { appConfig } from "@/lib/config/env";

export type CheckoutTarget = "pro";

// ── Client factory ─────────────────────────────────────────────────────────────

let _client: Stripe | null = null;

export function getStripeClientOrNull(): Stripe | null {
  if (_client) return _client;
  const key = appConfig.stripe.secretKey;
  if (!key) return null;
  _client = new Stripe(key, { apiVersion: "2026-04-22.dahlia" });
  return _client;
}

export function getStripeClient(): Stripe {
  const client = getStripeClientOrNull();
  if (!client) throw new Error("STRIPE_SECRET_KEY not configured");
  return client;
}

export function isStripeConfigured(): boolean {
  return Boolean(appConfig.stripe.secretKey && appConfig.stripe.priceIdPro);
}

// ── Price ID → Tier ───────────────────────────────────────────────────────────

export function tierFromPriceId(priceId: string | null | undefined): "pro" | "business" | null {
  if (!priceId) return null;
  if (priceId === appConfig.stripe.priceIdPro) return "pro";
  if (priceId === appConfig.stripe.priceIdBusiness) return "business";
  return null;
}

// ── Subscription cancellation ──────────────────────────────────────────────────

/**
 * Beendet ein Abo sofort (z. B. bei Konto-Löschung), damit nach dem Löschen
 * nicht weiter abgerechnet wird. Idempotent: ein bereits gelöschtes/unbekanntes
 * Abo wird als Erfolg behandelt. Wirft nur bei unerwarteten Stripe-Fehlern,
 * damit der Aufrufer die Löschung abbrechen kann, statt still weiterzulaufen.
 */
export async function cancelSubscriptionImmediately(
  subscriptionId: string | null | undefined,
): Promise<void> {
  if (!subscriptionId) return;
  const stripe = getStripeClientOrNull();
  if (!stripe) return; // Stripe nicht konfiguriert → nichts abzurechnen
  try {
    await stripe.subscriptions.cancel(subscriptionId);
  } catch (error) {
    const code =
      error && typeof error === "object" && "code" in error
        ? (error as { code?: string }).code
        : undefined;
    // Abo existiert nicht (mehr) → Ziel bereits erreicht.
    if (code === "resource_missing") return;
    throw error;
  }
}
