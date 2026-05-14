/**
 * Tier-Management — Solo (free) / Pro.
 *
 * Aktuell env-basiert: setze INVOICE_AGENT_TIER=free|pro in .env.
 * Später wird hier per Stripe-Webhook auf den effektiven Tier umgeschaltet
 * (Datenbank-Spalte oder externes Lookup).
 */

import type Database from "better-sqlite3";
import { getDb } from "@/lib/db/client";

export type Tier = "free" | "pro";

export type TierLimits = {
  maxOnlineAccounts: number; // Infinity = unbegrenzt
  communityRecipeShareEnabled: boolean;
  prioritySupport: boolean;
  label: string;
  priceMonthlyEur: number;
};

const LIMITS: Record<Tier, TierLimits> = {
  free: {
    maxOnlineAccounts: 3,
    communityRecipeShareEnabled: true,
    prioritySupport: false,
    label: "Solo",
    priceMonthlyEur: 0,
  },
  pro: {
    maxOnlineAccounts: Number.POSITIVE_INFINITY,
    communityRecipeShareEnabled: true,
    prioritySupport: true,
    label: "Pro",
    priceMonthlyEur: 9,
  },
};

export function getTier(): Tier {
  const raw = process.env.INVOICE_AGENT_TIER?.trim().toLowerCase();
  if (raw === "pro") return "pro";
  return "free";
}

export function getLimits(tier: Tier = getTier()): TierLimits {
  return LIMITS[tier];
}

export function canAddOnlineAccount(
  db?: Database.Database,
  tier: Tier = getTier(),
): { allowed: boolean; current: number; max: number } {
  const conn = db ?? getDb();
  const max = LIMITS[tier].maxOnlineAccounts;

  const row = conn
    .prepare(
      `SELECT COUNT(DISTINCT owner_id) AS count
       FROM credential_refs
       WHERE scope = 'portal' AND status = 'configured'`,
    )
    .get() as { count: number } | undefined;
  const current = row?.count ?? 0;

  return {
    allowed: current < max,
    current,
    max,
  };
}

export function isUpgradeNearby(
  db?: Database.Database,
  tier: Tier = getTier(),
): boolean {
  if (tier !== "free") return false;
  const { current, max } = canAddOnlineAccount(db, tier);
  if (!Number.isFinite(max)) return false;
  return current >= Math.max(1, max - 1);
}
