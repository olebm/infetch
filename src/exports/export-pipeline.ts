import { sql } from "@/lib/db/client";
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

export async function enqueueReadyInvoices(): Promise<number> {
  const result = await sql`
    INSERT INTO exports (invoice_id, export_target_id, status)
    SELECT invoices.id, export_targets.id, 'pending'
    FROM invoices
    CROSS JOIN export_targets
    WHERE invoices.status IN ('ready', 'exported')
      AND invoices.status != 'duplicate'
      AND export_targets.enabled = TRUE
      AND export_targets.recipient_email IS NOT NULL
      AND (
        invoices.preferred_export_target_id IS NULL
        OR export_targets.id = invoices.preferred_export_target_id
      )
    ON CONFLICT DO NOTHING
  `;
  return result.count;
}

export async function dispatchPendingExports(): Promise<DispatchResult> {
  const enqueued = await enqueueReadyInvoices();

  const rows = await sql<PendingExportRow[]>`
    SELECT
      exports.id,
      exports.invoice_id AS "invoiceId",
      export_targets.label AS "targetLabel",
      export_targets.recipient_email AS "recipientEmail",
      export_targets.smtp_slot AS "smtpSlot",
      vendors.name AS "vendorName",
      invoices.invoice_date AS "invoiceDate",
      invoices.amount_gross AS "amountGross",
      invoices.currency
    FROM exports
    JOIN export_targets ON export_targets.id = exports.export_target_id
    JOIN invoices ON invoices.id = exports.invoice_id
    LEFT JOIN vendors ON vendors.id = invoices.vendor_id
    WHERE exports.status = 'pending'
    ORDER BY exports.created_at ASC
  `;

  let sent = 0;
  let failed = 0;

  for (const row of rows) {
    try {
      const fileRows = await sql<PdfRow[]>`
        SELECT stored_path AS "storedPath", original_filename AS "originalFilename"
        FROM invoice_files
        WHERE invoice_id = ${row.invoiceId}
        ORDER BY id ASC LIMIT 1
      `;
      const file = fileRows[0];

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
      });

      await sql`
        UPDATE exports
        SET status = 'sent', sent_at = CURRENT_TIMESTAMP,
            attempt_count = attempt_count + 1, updated_at = CURRENT_TIMESTAMP
        WHERE id = ${row.id}
      `;

      await sql`
        UPDATE invoices SET status = 'exported', updated_at = CURRENT_TIMESTAMP
        WHERE id = ${row.invoiceId} AND status = 'ready'
      `;

      sent += 1;
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      await sql`
        UPDATE exports
        SET status = 'failed', last_error = ${msg},
            attempt_count = attempt_count + 1, updated_at = CURRENT_TIMESTAMP
        WHERE id = ${row.id}
      `;
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

export async function getExportTargets(): Promise<ExportTargetConfig[]> {
  const rows = await sql<Array<Omit<ExportTargetConfig, "enabled"> & { enabled: boolean }>>`
    SELECT id, target, label, recipient_email AS "recipientEmail",
      smtp_slot AS "smtpSlot", enabled
    FROM export_targets
    ORDER BY id ASC
  `;
  return rows.map((r) => ({ ...r, enabled: Boolean(r.enabled) }));
}

export async function saveExportTarget(
  target: string,
  recipientEmail: string | null,
  smtpSlot: SmtpCredentialOwnerId,
  enabled: boolean,
): Promise<void> {
  await sql`
    UPDATE export_targets
    SET recipient_email = ${recipientEmail || null}, smtp_slot = ${smtpSlot}, enabled = ${enabled}, updated_at = CURRENT_TIMESTAMP
    WHERE target = ${target}
  `;
}

export async function getExportStats(): Promise<Array<{ targetLabel: string; status: string; count: number }>> {
  const rows = await sql<Array<{ targetLabel: string; status: string; count: string }>>`
    SELECT export_targets.label AS "targetLabel", exports.status, COUNT(*) AS count
    FROM exports
    JOIN export_targets ON export_targets.id = exports.export_target_id
    GROUP BY export_targets.id, exports.status
  `;
  return rows.map((r) => ({ ...r, count: Number(r.count) }));
}
