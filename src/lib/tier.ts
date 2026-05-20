/**
 * Tier-Management — Free / Pro / Business (coming later).
 *
 * Die Tier-Zuordnung pro Organisation liegt in organizations.tier (DB).
 * Fallback für lokale Instanzen ohne Auth: INVOICE_AGENT_TIER env-var.
 *
 * Preise (Stand Mai 2026):
 *   Free:  €0        — 30 Rechnungen/Monat, 1 Postfach, 500 MB
 *   Pro:   €19/Monat — 150 Rechnungen/Monat, 3 Postfächer, 2 GB
 *   Business: kommt später (Portal-Agent, Multi-Org, Datev)
 */

import { sql } from "@/lib/db/client";
import { appConfig } from "@/lib/config/env";

export type Tier = "free" | "pro" | "business";

export type TierLimits = {
  /** Maximale Rechnungsimporte pro Kalendermonat. Infinity = unbegrenzt. */
  maxInvoicesPerMonth: number;
  /** Maximale Anzahl konfigurierter IMAP/SMTP-Postfächer. */
  maxMailAccounts: number;
  /** Maximale Anzahl Nutzer in der Organisation. */
  maxUsers: number;
  /** Maximaler Speicherplatz in Bytes (invoice_files.size_bytes summiert). */
  maxStorageBytes: number;
  /** Maximale Portal-/Online-Konten (Portal-Agent, aktuell deaktiviert). */
  maxOnlineAccounts: number;
  /** Auto-Approval (regelbasiert + lernend) verfügbar. */
  autoApprovalEnabled: boolean;
  /**
   * API-Direkt-Push zu Lexoffice / sevDesk (auto-transfer.ts).
   * NICHT für SMTP-Forward — der ist Kern-Feature und tier-unabhängig.
   */
  exportEnabled: boolean;
  /** Export zu Datev (API, kommt später). */
  datevExportEnabled: boolean;
  /** Bulk-Download aller Rechnungen (ZIP ohne Vendor-Filter). Free = false. */
  bulkDownloadEnabled: boolean;
  /** Retroaktiver IMAP-Scan (12 Monate zurück), manuell auslösbar. Free = false. */
  retroactiveScanEnabled: boolean;
  /** Anzeige-Label für UI. */
  label: string;
  /** Monatspreis in Euro (ohne MwSt.). */
  priceMonthlyEur: number;
};

const MB = 1024 * 1024;
const GB = 1024 * MB;

export const TIER_LIMITS: Record<Tier, TierLimits> = {
  free: {
    maxInvoicesPerMonth:   30,
    maxMailAccounts:       1,
    maxUsers:              1,
    maxStorageBytes:       500 * MB,
    maxOnlineAccounts:     0,
    autoApprovalEnabled:   true,
    exportEnabled:         false,
    datevExportEnabled:    false,
    bulkDownloadEnabled:     false,
    retroactiveScanEnabled:  false,
    label:                   "Free",
    priceMonthlyEur:       0,
  },
  pro: {
    maxInvoicesPerMonth:   150,
    maxMailAccounts:       3,
    maxUsers:              3,
    maxStorageBytes:       2 * GB,
    maxOnlineAccounts:     5,
    autoApprovalEnabled:   true,
    exportEnabled:         true,
    datevExportEnabled:    false,
    bulkDownloadEnabled:     true,
    retroactiveScanEnabled:  true,
    label:                   "Pro",
    priceMonthlyEur:       19,
  },
  business: {
    maxInvoicesPerMonth:   Number.POSITIVE_INFINITY,
    maxMailAccounts:       Number.POSITIVE_INFINITY,
    maxUsers:              Number.POSITIVE_INFINITY,
    maxStorageBytes:       20 * GB,
    maxOnlineAccounts:     20,
    autoApprovalEnabled:   true,
    exportEnabled:         true,
    datevExportEnabled:    true,
    bulkDownloadEnabled:     true,
    retroactiveScanEnabled:  true,
    label:                   "Business",
    priceMonthlyEur:       49,
  },
};

// ── Tier-Lookup ───────────────────────────────────────────────────────────────

/**
 * Gibt den Tier einer Organisation aus der DB zurück.
 * Fallback: INVOICE_AGENT_TIER env-var, dann "free".
 */
export async function getOrgTier(organizationId: string | null | undefined): Promise<Tier> {
  // Free-only Launch: zentrale Klemme. Solange Pro deaktiviert ist, ist die
  // effektive Stufe IMMER "free" — unabhängig von organizations.tier (z. B.
  // Alt-Abos). Damit greifen alle nachgelagerten Gates (canExport, Limits,
  // isPro-Props) automatisch als Free.
  if (!appConfig.billing.proEnabled) return "free";
  if (organizationId) {
    const rows = await sql<{ tier: string }[]>`
      SELECT tier FROM organizations WHERE id = ${organizationId} LIMIT 1
    `;
    const raw = rows[0]?.tier;
    if (raw === "pro" || raw === "business") return raw;
    if (raw === "free") return "free";
  }
  // Fallback für lokale / test Instanzen
  return getEnvTier();
}

/** Liest Tier aus INVOICE_AGENT_TIER env-var. Fallback: "free". */
export function getEnvTier(): Tier {
  if (!appConfig.billing.proEnabled) return "free";
  const raw = process.env.INVOICE_AGENT_TIER?.trim().toLowerCase();
  if (raw === "pro") return "pro";
  if (raw === "business") return "business";
  return "free";
}

export function getLimits(tier: Tier): TierLimits {
  return TIER_LIMITS[tier];
}

// ── Quota-Checks ──────────────────────────────────────────────────────────────

/**
 * Prüft ob ein weiterer Rechnungsimport im aktuellen Kalendermonat erlaubt ist.
 */
export async function canImportInvoice(
  organizationId: string | null | undefined,
): Promise<{ allowed: boolean; current: number; max: number; tier: Tier }> {
  const tier  = await getOrgTier(organizationId);
  const max   = TIER_LIMITS[tier].maxInvoicesPerMonth;

  if (!Number.isFinite(max)) {
    return { allowed: true, current: 0, max, tier };
  }

  const current = await getMonthlyImportCount(organizationId);
  return { allowed: current < max, current, max, tier };
}

/**
 * Zählt importierte Rechnungen im laufenden Kalendermonat für eine Organisation.
 */
export async function getMonthlyImportCount(
  organizationId: string | null | undefined,
): Promise<number> {
  const rows = await sql<{ count: string }[]>`
    SELECT COUNT(*) AS count
    FROM invoices
    WHERE organization_id = ${organizationId ?? null}
      AND created_at >= TO_CHAR(DATE_TRUNC('month', NOW()), 'YYYY-MM-DD')
  `;
  return Number(rows[0]?.count ?? 0);
}

/**
 * Gibt genutzten Speicherplatz in Bytes für eine Organisation zurück.
 */
export async function getStorageUsageBytes(
  organizationId: string | null | undefined,
): Promise<number> {
  const rows = await sql<{ bytes: string }[]>`
    SELECT COALESCE(SUM(f.size_bytes), 0) AS bytes
    FROM invoice_files f
    INNER JOIN invoices i ON i.id = f.invoice_id
    WHERE i.organization_id = ${organizationId ?? null}
  `;
  return Number(rows[0]?.bytes ?? 0);
}

/**
 * Prüft ob der Storage-Limit für eine Organisation überschritten wäre.
 */
export async function canStoreFile(
  organizationId: string | null | undefined,
  fileSizeBytes: number,
): Promise<{ allowed: boolean; usedBytes: number; maxBytes: number; tier: Tier }> {
  const tier     = await getOrgTier(organizationId);
  const maxBytes = TIER_LIMITS[tier].maxStorageBytes;
  const usedBytes = await getStorageUsageBytes(organizationId);
  return {
    allowed: usedBytes + fileSizeBytes <= maxBytes,
    usedBytes,
    maxBytes,
    tier,
  };
}

/**
 * Prüft ob API-Direkt-Push (Lexoffice / sevDesk) für eine Organisation
 * erlaubt ist. SMTP-Forward an einen E-Mail-Empfänger ist tier-unabhängig
 * erlaubt und läuft NICHT durch diesen Gate (siehe export-pipeline.ts).
 */
export async function canExport(
  organizationId: string | null | undefined,
): Promise<boolean> {
  const tier = await getOrgTier(organizationId);
  return TIER_LIMITS[tier].exportEnabled;
}

/**
 * Prüft ob Bulk-Download (alle Rechnungen ohne Vendor-Filter) erlaubt ist.
 * Free = nur Download mit vendorId-Filter erlaubt.
 * Pro/Business = ungefilterter ZIP-Download erlaubt.
 */
export async function canBulkDownload(
  organizationId: string | null | undefined,
): Promise<boolean> {
  const tier = await getOrgTier(organizationId);
  return TIER_LIMITS[tier].bulkDownloadEnabled;
}

/**
 * Gibt das früheste Datum zurück, ab dem der IMAP-Scanner Mails abholen soll.
 *
 * Free  → Erster Tag des laufenden Kalendermonats (nur aktuelle Mails).
 * Pro/Business → Nutzt globalen SYNC_MONTHS_BACK-Wert (Standard: 6 Monate).
 *
 * Wird im regulären Autopilot-Scan pro Mail-Account genutzt.
 * Der manuelle retroaktive Scan (Pro) verwendet immer 12 Monate.
 */
export function getScanSinceDate(tier: Tier, syncMonthsBack: number): Date {
  if (tier === "free") {
    const now = new Date();
    return new Date(now.getFullYear(), now.getMonth(), 1);
  }
  const d = new Date();
  d.setMonth(d.getMonth() - syncMonthsBack);
  return d;
}

/**
 * Prüft ob retroaktiver 12-Monats-Scan für eine Organisation erlaubt ist.
 */
export async function canRetroactiveScan(
  organizationId: string | null | undefined,
): Promise<boolean> {
  const tier = await getOrgTier(organizationId);
  return TIER_LIMITS[tier].retroactiveScanEnabled;
}

// ── Upgrade-Hint ──────────────────────────────────────────────────────────────

/**
 * Gibt true zurück wenn die Org nahe am Rechnungs-Monats-Limit ist (≥ 80 %).
 */
export async function isNearInvoiceLimit(
  organizationId: string | null | undefined,
): Promise<boolean> {
  const tier  = await getOrgTier(organizationId);
  const max   = TIER_LIMITS[tier].maxInvoicesPerMonth;
  if (!Number.isFinite(max)) return false;
  const current = await getMonthlyImportCount(organizationId);
  return current >= Math.floor(max * 0.8);
}

// ── Legacy-Compat (wird von online-accounts verwendet) ────────────────────────

/** @deprecated Portale sind deaktiviert — immer { allowed: false, current: 0, max: 0 } */
export async function canAddOnlineAccount(
  _tier?: Tier,
): Promise<{ allowed: boolean; current: number; max: number }> {
  return { allowed: false, current: 0, max: 0 };
}

/** @deprecated Nutze getOrgTier() */
export function getTier(): Tier {
  return getEnvTier();
}
