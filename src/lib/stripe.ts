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
