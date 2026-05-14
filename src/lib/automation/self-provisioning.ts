import { sql } from "@/lib/db/client";
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
  successCount: string;
  recentFailures: string;
  maxAmount: number | null;
};

/**
 * Legt automatisch Auto-Approval-Rules für Vendors an, die genug erfolgreiche
 * Imports haben und keine offenen Probleme. Idempotent — Vendors mit
 * existierender Rule werden übersprungen.
 *
 * Sicherheit: max_amount_cents = max(historisch) × Multiplier. Vendor mit
 * 'failed'-Imports in letzten 90 Tagen wird NICHT auto-provisioniert.
 */
export async function provisionAutoApprovalRules(): Promise<ProvisioningResult> {
  const minImports = appConfig.selfHealing.selfProvisionMinImports;
  const multiplier = appConfig.selfHealing.selfProvisionAmountMultiplier;

  // Vendor-Stats: erfolgreiche Imports (ready/exported) und failures in den letzten 90 Tagen
  const candidates = await sql<Candidate[]>`
    SELECT
      v.id AS "vendorId",
      v.name AS "vendorName",
      SUM(CASE WHEN i.status IN ('ready', 'exported') THEN 1 ELSE 0 END) AS "successCount",
      SUM(CASE WHEN i.status = 'failed' THEN 1 ELSE 0 END) AS "recentFailures",
      MAX(CASE WHEN i.status IN ('ready', 'exported') THEN i.amount_gross END) AS "maxAmount"
    FROM vendors v
    JOIN invoices i ON i.vendor_id = v.id
    WHERE i.created_at >= NOW() - INTERVAL '90 days'
      AND NOT EXISTS (
        SELECT 1 FROM auto_approval_rules r
        WHERE r.vendor_id = v.id AND r.enabled = TRUE
      )
    GROUP BY v.id, v.name
    HAVING SUM(CASE WHEN i.status IN ('ready', 'exported') THEN 1 ELSE 0 END) >= ${minImports}
       AND SUM(CASE WHEN i.status = 'failed' THEN 1 ELSE 0 END) = 0
       AND MAX(CASE WHEN i.status IN ('ready', 'exported') THEN i.amount_gross END) IS NOT NULL
  `;

  const result: ProvisioningResult = {
    scannedVendors: candidates.length,
    provisioned: [],
  };

  for (const candidate of candidates) {
    if (candidate.maxAmount === null) continue;
    const successCount = Number(candidate.successCount);
    const maxCents = Math.ceil(candidate.maxAmount * multiplier * 100);

    await sql`
      INSERT INTO auto_approval_rules (vendor_id, vendor_pattern, max_amount_cents, enabled)
      VALUES (${candidate.vendorId}, NULL, ${maxCents}, TRUE)
    `;

    result.provisioned.push({
      vendorId: candidate.vendorId,
      vendorName: candidate.vendorName,
      successCount,
      maxAmountCents: maxCents,
    });

    await recordSyncEvent({
      level: "info",
      eventType: "auto_approval_rule_provisioned",
      vendorId: candidate.vendorId,
      message: `Auto-Approval-Rule für "${candidate.vendorName}" angelegt (max ${(maxCents / 100).toFixed(2)} €, basierend auf ${successCount} erfolgreichen Imports).`,
      metadata: {
        maxAmountCents: maxCents,
        basisSuccessCount: successCount,
        multiplier,
      },
    });
  }

  return result;
}

export type { Candidate };
