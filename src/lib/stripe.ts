/**
 * Stripe-Stub — generiert Checkout-URLs aus env-Variablen.
 *
 * Echte Stripe-Integration (server-side checkout session create) kommt mit
 * dem ersten zahlenden Kunden. Bis dahin sind PRICE_LINK_PRO/TEAM einfach
 * Stripe Payment-Links (https://buy.stripe.com/...).
 */

import type { Tier } from "@/lib/tier";

export type CheckoutTarget = "pro";

export function getCheckoutUrl(_target: CheckoutTarget): string | null {
  const url = process.env.STRIPE_PAYMENT_LINK_PRO?.trim();
  if (!url) return null;
  if (!url.startsWith("https://")) return null;
  return url;
}

export function isStripeConfigured(): boolean {
  return Boolean(getCheckoutUrl("pro"));
}
