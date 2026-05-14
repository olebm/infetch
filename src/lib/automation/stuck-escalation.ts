import { sql } from "@/lib/db/client";
import { appConfig } from "@/lib/config/env";
import { recordSyncEvent } from "@/lib/db/events";

export type StuckEscalationResult = {
  scanned: number;
  escalated: number;
};

type Row = {
  id: number;
  vendorId: number | null;
  ageDays: number;
};

/**
 * Eskaliert Rechnungen die zu lange im 'needs_review' hängen:
 * nach `stuckEscalationAfterDays` werden sie auf 'ignored' gesetzt — die
 * Rechnung wäre eh nie verarbeitet worden, und der User merkt nichts davon
 * weil sie aus der Review-Queue raus ist. DB-Row bleibt für Audit.
 */
export async function escalateStuckReviews(): Promise<StuckEscalationResult> {
  const days = appConfig.selfHealing.stuckEscalationAfterDays;

  const rows = await sql<Row[]>`
    SELECT id, vendor_id AS "vendorId",
      EXTRACT(EPOCH FROM (NOW() - updated_at))::INTEGER / 86400 AS "ageDays"
    FROM invoices
    WHERE status = 'needs_review'
      AND updated_at <= NOW() - (${days} || ' days')::INTERVAL
  `;

  const result: StuckEscalationResult = { scanned: rows.length, escalated: 0 };

  for (const row of rows) {
    await sql`UPDATE invoices SET status = 'ignored', updated_at = CURRENT_TIMESTAMP WHERE id = ${row.id}`;
    result.escalated++;
    await recordSyncEvent({
      level: "info",
      eventType: "stuck_review_escalated",
      invoiceId: row.id,
      vendorId: row.vendorId,
      message: `Rechnung war ${row.ageDays} Tage in Review — auf 'ignored' eskaliert.`,
      metadata: { ageDays: row.ageDays, thresholdDays: days },
    });
  }

  return result;
}
