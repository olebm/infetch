import type Database from "better-sqlite3";
import { appConfig } from "@/lib/config/env";
import { recordSyncEvent } from "@/lib/db/events";

export type ProvisioningResult = {
  scannedVendors: number;
  provisioned: Array<{
    vendorId: number;
    vendorName: string;
    successCount: number;
    maxAmountCents: number;
  }>;
};

type Candidate = {
  vendorId: number;
  vendorName: string;
  successCount: number;
  recentFailures: number;
  maxAmountCents: number | null;
};

/**
 * Legt automatisch Auto-Approval-Rules für Vendors an, die genug erfolgreiche
 * Imports haben und keine offenen Probleme. Idempotent — Vendors mit
 * existierender Rule werden übersprungen.
 *
 * Sicherheit: max_amount_cents = max(historisch) × Multiplier. Vendor mit
 * 'failed'-Imports in letzten 90 Tagen wird NICHT auto-provisioniert.
 */
export function provisionAutoApprovalRules(db: Database.Database): ProvisioningResult {
  const minImports = appConfig.selfHealing.selfProvisionMinImports;
  const multiplier = appConfig.selfHealing.selfProvisionAmountMultiplier;

  // Vendor-Stats: erfolgreiche Imports (ready/exported) und failures in den letzten 90 Tagen
  const candidates = db
    .prepare(
      `SELECT
         v.id AS vendorId,
         v.name AS vendorName,
         SUM(CASE WHEN i.status IN ('ready', 'exported') THEN 1 ELSE 0 END) AS successCount,
         SUM(CASE WHEN i.status = 'failed' THEN 1 ELSE 0 END) AS recentFailures,
         MAX(CASE WHEN i.status IN ('ready', 'exported') THEN i.amount_gross END) AS maxAmount
       FROM vendors v
       JOIN invoices i ON i.vendor_id = v.id
       WHERE i.created_at >= datetime('now', '-90 days')
         AND NOT EXISTS (
           SELECT 1 FROM auto_approval_rules r
           WHERE r.vendor_id = v.id AND r.enabled = 1
         )
       GROUP BY v.id, v.name
       HAVING successCount >= ? AND recentFailures = 0 AND maxAmount IS NOT NULL`,
    )
    .all(minImports) as Array<{
    vendorId: number;
    vendorName: string;
    successCount: number;
    recentFailures: number;
    maxAmount: number;
  }>;

  const result: ProvisioningResult = {
    scannedVendors: candidates.length,
    provisioned: [],
  };

  const insertRule = db.prepare(
    `INSERT INTO auto_approval_rules (vendor_id, vendor_pattern, max_amount_cents, enabled)
     VALUES (?, NULL, ?, 1)`,
  );

  for (const candidate of candidates) {
    const maxCents = Math.ceil(candidate.maxAmount * multiplier * 100);
    insertRule.run(candidate.vendorId, maxCents);

    result.provisioned.push({
      vendorId: candidate.vendorId,
      vendorName: candidate.vendorName,
      successCount: candidate.successCount,
      maxAmountCents: maxCents,
    });

    recordSyncEvent(db, {
      level: "info",
      eventType: "auto_approval_rule_provisioned",
      vendorId: candidate.vendorId,
      message: `Auto-Approval-Rule für "${candidate.vendorName}" angelegt (max ${(maxCents / 100).toFixed(2)} €, basierend auf ${candidate.successCount} erfolgreichen Imports).`,
      metadata: {
        maxAmountCents: maxCents,
        basisSuccessCount: candidate.successCount,
        multiplier,
      },
    });
  }

  return result;
}

export type { Candidate };
