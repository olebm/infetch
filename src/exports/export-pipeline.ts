import type Database from "better-sqlite3";
import { getDb } from "@/lib/db/client";
import { sendInvoiceMail } from "@/mail/smtp-client";
import type { SmtpCredentialOwnerId } from "@/mail/smtp-account-slots";

export type DispatchResult = {
  enqueued: number;
  sent: number;
  failed: number;
  total: number;
};

type PendingExportRow = {
  id: number;
  invoiceId: number;
  targetLabel: string;
  recipientEmail: string;
  smtpSlot: SmtpCredentialOwnerId;
  vendorName: string | null;
  invoiceDate: string | null;
  amountGross: number | null;
  currency: string | null;
};

type PdfRow = {
  storedPath: string;
  originalFilename: string;
};

export function enqueueReadyInvoices(db?: Database.Database): number {
  const resolvedDb = db ?? getDb();
  const result = resolvedDb
    .prepare(
      `INSERT OR IGNORE INTO exports (invoice_id, export_target_id, status)
       SELECT invoices.id, export_targets.id, 'pending'
       FROM invoices
       CROSS JOIN export_targets
       WHERE invoices.status IN ('ready', 'exported')
         AND invoices.status != 'duplicate'
         AND export_targets.enabled = 1
         AND export_targets.recipient_email IS NOT NULL
         AND (
           invoices.preferred_export_target_id IS NULL
           OR export_targets.id = invoices.preferred_export_target_id
         )`,
    )
    .run();
  return result.changes;
}

export async function dispatchPendingExports(db?: Database.Database): Promise<DispatchResult> {
  const resolvedDb = db ?? getDb();

  const enqueued = enqueueReadyInvoices(resolvedDb);

  const rows = resolvedDb
    .prepare(
      `SELECT
         exports.id,
         exports.invoice_id AS invoiceId,
         export_targets.label AS targetLabel,
         export_targets.recipient_email AS recipientEmail,
         export_targets.smtp_slot AS smtpSlot,
         vendors.name AS vendorName,
         invoices.invoice_date AS invoiceDate,
         invoices.amount_gross AS amountGross,
         invoices.currency
       FROM exports
       JOIN export_targets ON export_targets.id = exports.export_target_id
       JOIN invoices ON invoices.id = exports.invoice_id
       LEFT JOIN vendors ON vendors.id = invoices.vendor_id
       WHERE exports.status = 'pending'
       ORDER BY exports.created_at ASC`,
    )
    .all() as PendingExportRow[];

  let sent = 0;
  let failed = 0;

  for (const row of rows) {
    try {
      const file = resolvedDb
        .prepare(
          `SELECT stored_path AS storedPath, original_filename AS originalFilename
           FROM invoice_files
           WHERE invoice_id = ?
           ORDER BY id ASC LIMIT 1`,
        )
        .get(row.invoiceId) as PdfRow | undefined;

      if (!file) {
        throw new Error("Keine PDF-Datei für diese Rechnung gefunden.");
      }

      await sendInvoiceMail({
        smtpSlot: row.smtpSlot ?? "primary",
        to: row.recipientEmail,
        vendorName: row.vendorName ?? "Unbekannt",
        invoiceDate: row.invoiceDate,
        amountGross: row.amountGross,
        currency: row.currency,
        pdfPath: file.storedPath,
        originalFilename: file.originalFilename,
        db: resolvedDb,
      });

      resolvedDb
        .prepare(
          `UPDATE exports
           SET status = 'sent', sent_at = CURRENT_TIMESTAMP,
               attempt_count = attempt_count + 1, updated_at = CURRENT_TIMESTAMP
           WHERE id = ?`,
        )
        .run(row.id);

      resolvedDb
        .prepare(
          `UPDATE invoices SET status = 'exported', updated_at = CURRENT_TIMESTAMP
           WHERE id = ? AND status = 'ready'`,
        )
        .run(row.invoiceId);

      sent += 1;
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      resolvedDb
        .prepare(
          `UPDATE exports
           SET status = 'failed', last_error = ?,
               attempt_count = attempt_count + 1, updated_at = CURRENT_TIMESTAMP
           WHERE id = ?`,
        )
        .run(msg, row.id);
      failed += 1;
    }
  }

  return { enqueued, sent, failed, total: rows.length };
}

export type ExportTargetConfig = {
  id: number;
  target: string;
  label: string;
  recipientEmail: string | null;
  smtpSlot: SmtpCredentialOwnerId;
  enabled: boolean;
};

export function getExportTargets(db?: Database.Database): ExportTargetConfig[] {
  const resolvedDb = db ?? getDb();
  const rows = resolvedDb
    .prepare(
      `SELECT id, target, label, recipient_email AS recipientEmail,
         smtp_slot AS smtpSlot, enabled
       FROM export_targets
       ORDER BY id ASC`,
    )
    .all() as Array<Omit<ExportTargetConfig, "enabled"> & { enabled: number }>;
  return rows.map((r) => ({ ...r, enabled: r.enabled === 1 }));
}

export function saveExportTarget(
  target: string,
  recipientEmail: string | null,
  smtpSlot: SmtpCredentialOwnerId,
  enabled: boolean,
  db?: Database.Database,
): void {
  const resolvedDb = db ?? getDb();
  resolvedDb
    .prepare(
      `UPDATE export_targets
       SET recipient_email = ?, smtp_slot = ?, enabled = ?, updated_at = CURRENT_TIMESTAMP
       WHERE target = ?`,
    )
    .run(recipientEmail || null, smtpSlot, enabled ? 1 : 0, target);
}

export function getExportStats(db?: Database.Database) {
  const resolvedDb = db ?? getDb();
  const rows = resolvedDb
    .prepare(
      `SELECT export_targets.label AS targetLabel, exports.status, COUNT(*) AS count
       FROM exports
       JOIN export_targets ON export_targets.id = exports.export_target_id
       GROUP BY export_targets.id, exports.status`,
    )
    .all() as Array<{ targetLabel: string; status: string; count: number }>;
  return rows;
}
