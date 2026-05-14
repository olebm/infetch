import type Database from "better-sqlite3";
import fs from "node:fs";
import { appConfig } from "@/lib/config/env";
import { recordSyncEvent } from "@/lib/db/events";

export type CleanupResult = {
  scanned: number;
  filesDeleted: number;
  errors: number;
};

type Row = {
  invoiceId: number;
  fileId: number;
  storedPath: string;
};

/**
 * Löscht Disk-Files für 'ignored' Rechnungen, die älter als
 * cleanupIgnoredAfterDays sind. Die DB-Rows bleiben für Audit erhalten.
 *
 * Idempotent — bereits gelöschte Files werden übersprungen.
 */
export function cleanupIgnoredFiles(db: Database.Database): CleanupResult {
  const days = appConfig.selfHealing.cleanupIgnoredAfterDays;

  const rows = db
    .prepare(
      `SELECT i.id AS invoiceId, f.id AS fileId, f.stored_path AS storedPath
       FROM invoices i
       JOIN invoice_files f ON f.invoice_id = i.id
       WHERE i.status = 'ignored'
         AND i.updated_at <= datetime('now', ? || ' days')
         AND f.stored_path IS NOT NULL`,
    )
    .all(`-${days}`) as Row[];

  const result: CleanupResult = { scanned: rows.length, filesDeleted: 0, errors: 0 };

  const clearPath = db.prepare(
    `UPDATE invoice_files SET stored_path = NULL WHERE id = ?`,
  );

  for (const row of rows) {
    try {
      if (fs.existsSync(row.storedPath)) {
        fs.unlinkSync(row.storedPath);
      }
      clearPath.run(row.fileId);
      result.filesDeleted++;
    } catch (error) {
      result.errors++;
      recordSyncEvent(db, {
        level: "warning",
        eventType: "cleanup_ignored_failed",
        invoiceId: row.invoiceId,
        message: `Cleanup für ${row.storedPath} fehlgeschlagen: ${error instanceof Error ? error.message : String(error)}`,
        metadata: { fileId: row.fileId, storedPath: row.storedPath },
      });
    }
  }

  if (result.filesDeleted > 0) {
    recordSyncEvent(db, {
      level: "info",
      eventType: "cleanup_ignored_completed",
      message: `${result.filesDeleted} PDF-Files für 'ignored' Rechnungen gelöscht (älter als ${days} Tage).`,
      metadata: { scanned: result.scanned, deleted: result.filesDeleted, errors: result.errors },
    });
  }

  return result;
}
