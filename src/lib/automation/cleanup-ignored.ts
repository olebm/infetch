import { sql } from "@/lib/db/client";
import { appConfig } from "@/lib/config/env";
import { recordSyncEvent } from "@/lib/db/events";
import { BUCKETS, deleteFromStorage } from "@/lib/supabase/storage";

export type CleanupResult = {
  scanned: number;
  filesDeleted: number;
  errors: number;
};

type Row = {
  invoiceId: number;
  fileId: number;
  storedPath: string;
  rawTextPath: string | null;
};

/**
 * Löscht Disk-Files für 'ignored' Rechnungen, die älter als
 * cleanupIgnoredAfterDays sind. Die DB-Rows bleiben für Audit erhalten.
 *
 * Idempotent — bereits gelöschte Files werden übersprungen.
 */
export async function cleanupIgnoredFiles(): Promise<CleanupResult> {
  const days = appConfig.selfHealing.cleanupIgnoredAfterDays;

  const rows = await sql<Row[]>`
    SELECT i.id AS "invoiceId", f.id AS "fileId", f.stored_path AS "storedPath",
           i.raw_text_path AS "rawTextPath"
    FROM invoices i
    JOIN invoice_files f ON f.invoice_id = i.id
    WHERE i.status = 'ignored'
      AND i.updated_at::TIMESTAMPTZ <= NOW() - (${days} || ' days')::INTERVAL
      AND f.stored_path IS NOT NULL
  `;

  const result: CleanupResult = { scanned: rows.length, filesDeleted: 0, errors: 0 };

  for (const row of rows) {
    try {
      // stored_path / raw_text_path enthalten Supabase-Storage-Keys, keine FS-Pfade.
      await deleteFromStorage(BUCKETS.INVOICES, row.storedPath);
      if (row.rawTextPath) {
        await deleteFromStorage(BUCKETS.RAW_TEXT, row.rawTextPath);
      }
      await sql`UPDATE invoice_files SET stored_path = NULL WHERE id = ${row.fileId}`;
      result.filesDeleted++;
    } catch (error) {
      result.errors++;
      await recordSyncEvent({
        level: "warning",
        eventType: "cleanup_ignored_failed",
        invoiceId: row.invoiceId,
        message: `Cleanup für ${row.storedPath} fehlgeschlagen: ${error instanceof Error ? error.message : String(error)}`,
        metadata: { fileId: row.fileId, storedPath: row.storedPath },
      });
    }
  }

  if (result.filesDeleted > 0) {
    await recordSyncEvent({
      level: "info",
      eventType: "cleanup_ignored_completed",
      message: `${result.filesDeleted} PDF-Files für 'ignored' Rechnungen gelöscht (älter als ${days} Tage).`,
      metadata: { scanned: result.scanned, deleted: result.filesDeleted, errors: result.errors },
    });
  }

  return result;
}
