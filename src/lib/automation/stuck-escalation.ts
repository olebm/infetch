import type Database from "better-sqlite3";
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
export function escalateStuckReviews(db: Database.Database): StuckEscalationResult {
  const days = appConfig.selfHealing.stuckEscalationAfterDays;

  const rows = db
    .prepare(
      `SELECT id, vendor_id AS vendorId,
         CAST((julianday('now') - julianday(updated_at)) AS INTEGER) AS ageDays
       FROM invoices
       WHERE status = 'needs_review'
         AND updated_at <= datetime('now', ? || ' days')`,
    )
    .all(`-${days}`) as Row[];

  const result: StuckEscalationResult = { scanned: rows.length, escalated: 0 };

  const update = db.prepare(
    `UPDATE invoices SET status = 'ignored', updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
  );

  for (const row of rows) {
    update.run(row.id);
    result.escalated++;
    recordSyncEvent(db, {
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
