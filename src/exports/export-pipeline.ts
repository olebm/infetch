import { unsafeGlobalSql as sql } from "@/lib/db/unsafe-global";
import { sendInvoiceMail } from "@/mail/smtp-client";
import type { SmtpCredentialOwnerId } from "@/mail/smtp-account-slots";
import { BUCKETS, downloadFromStorage } from "@/lib/supabase/storage";
import { withAdvisoryLock } from "@/lib/db/advisory-lock";
import { readOrgJsonSetting } from "@/lib/db/settings-store";
import { renderPdfFilenameTemplate } from "@/lib/recipients";

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
  organizationId: string | null;
};

type PdfRow = {
  storedPath: string;
  originalFilename: string;
};

export async function enqueueReadyInvoices(): Promise<number> {
  // SECURITY: Cross-Join nur noch innerhalb derselben Organisation.
  // Vorher hätten Cross-Tenant-Targets eine Invoice an die falsche Org versendet.
  const result = await sql`
    INSERT INTO exports (invoice_id, export_target_id, status, organization_id)
    SELECT invoices.id, export_targets.id, 'pending', invoices.organization_id
    FROM invoices
    JOIN export_targets ON export_targets.organization_id = invoices.organization_id
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

/**
 * Markiert alle AKTUELL bestehenden Rechnungen einer Org als 'skipped' für das
 * angegebene Target. Genutzt beim erstmaligen Anlegen eines Empfängers mit
 * Default "nur neue": So überspringt enqueueReadyInvoices (ON CONFLICT) die
 * Alt-Rechnungen dauerhaft, künftige Rechnungen laufen normal. Bewusst über
 * ALLE Status (nicht nur ready/exported), damit auch später freigegebene
 * Alt-Rechnungen übersprungen bleiben. Gibt die Zahl der markierten zurück.
 */
export async function skipExistingInvoicesForTarget(
  orgId: string,
  target: string,
  db: typeof sql = sql,
): Promise<number> {
  const result = await db`
    INSERT INTO exports (invoice_id, export_target_id, status, organization_id)
    SELECT invoices.id, export_targets.id, 'skipped', invoices.organization_id
    FROM invoices
    JOIN export_targets ON export_targets.organization_id = invoices.organization_id
      AND export_targets.target = ${target}
    WHERE invoices.organization_id = ${orgId}
    ON CONFLICT DO NOTHING
  `;
  return result.count;
}

/**
 * Setzt alle bereits VERSENDETEN Exports eines Empfängers zurück auf 'pending',
 * sodass dispatchPendingExports sie erneut verschickt — über das AKTUELLE
 * Absende-Konto (smtp_slot) des Targets. Use-Case: Empfänger wurde auf eine
 * andere Absende-Adresse umgestellt; Buchhaltungs-Apps (Kontist, sevDesk)
 * matchen über den Absender, daher müssen Alt-Rechnungen mit der neuen Adresse
 * erneut zugestellt werden. Nur 'sent' wird zurückgesetzt (nicht 'skipped' /
 * 'failed'). Gibt die Zahl der zum Neuversand markierten Exports zurück.
 */
export async function resendSentInvoicesForTarget(orgId: string, target: string): Promise<number> {
  const result = await sql`
    UPDATE exports
    SET status = 'pending', updated_at = CURRENT_TIMESTAMP
    WHERE organization_id = ${orgId}
      AND status = 'sent'
      AND export_target_id IN (
        SELECT id FROM export_targets
        WHERE organization_id = ${orgId} AND target = ${target}
      )
  `;
  return result.count;
}

export async function dispatchPendingExports(): Promise<DispatchResult> {
  return withAdvisoryLock("export_dispatch", dispatchPendingExportsImpl, () => ({
    enqueued: 0,
    sent: 0,
    failed: 0,
    total: 0,
  }));
}

async function dispatchPendingExportsImpl(): Promise<DispatchResult> {
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
      invoices.currency,
      invoices.organization_id AS "organizationId"
    FROM exports
    JOIN export_targets ON export_targets.id = exports.export_target_id
    JOIN invoices ON invoices.id = exports.invoice_id
    LEFT JOIN vendors ON vendors.id = invoices.vendor_id
    WHERE exports.status = 'pending'
    ORDER BY exports.created_at ASC
  `;

  // Betreffvorlage pro Org (org-gescopt, memoisiert): vorher EINE globale Vorlage
  // für ALLE Mandanten — ein Mandant überschrieb damit den Betreff aller anderen.
  // Lazy-Cache, da ein Dispatch-Batch i.d.R. nur eine Org enthält → kein N+1.
  const subjectTemplateCache = new Map<string, string>();
  const subjectTemplateFor = async (orgId: string | null): Promise<string> => {
    const cacheKey = orgId ?? "";
    const cached = subjectTemplateCache.get(cacheKey);
    if (cached !== undefined) return cached;
    const tpl = await readOrgJsonSetting<string>("invoice_subject_template", orgId, "");
    subjectTemplateCache.set(cacheKey, tpl);
    return tpl;
  };
  // PDF-Dateiname-Vorlage pro Org (org-gescopt + memoisiert, analog Betreff;
  // INFETCH-278). Leer → Originaldateiname beibehalten.
  const pdfTemplateCache = new Map<string, string>();
  const pdfFilenameTemplateFor = async (orgId: string | null): Promise<string> => {
    const cacheKey = orgId ?? "";
    const cached = pdfTemplateCache.get(cacheKey);
    if (cached !== undefined) return cached;
    const tpl = await readOrgJsonSetting<string>("pdf_filename_template", orgId, "");
    pdfTemplateCache.set(cacheKey, tpl);
    return tpl;
  };

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

      // stored_path ist ein Supabase-Storage-Key — Inhalt vor Versand laden.
      const pdfContent = await downloadFromStorage(BUCKETS.INVOICES, file.storedPath);

      // Apply PDF filename template if configured.
      const amountStr =
        row.amountGross != null
          ? `${row.amountGross.toFixed(2)} ${row.currency ?? ""}`.trim()
          : undefined;
      const pdfTemplate = await pdfFilenameTemplateFor(row.organizationId);
      const attachmentFilename = pdfTemplate.trim()
        ? renderPdfFilenameTemplate(pdfTemplate, {
            vendor: row.vendorName,
            date: row.invoiceDate,
            amount: amountStr ?? null,
          })
        : undefined;

      await sendInvoiceMail({
        smtpSlot: row.smtpSlot ?? "primary",
        organizationId: row.organizationId,
        to: row.recipientEmail,
        vendorName: row.vendorName ?? "Unbekannt",
        invoiceDate: row.invoiceDate,
        amountGross: row.amountGross,
        currency: row.currency,
        subjectTemplate: await subjectTemplateFor(row.organizationId),
        pdfContent,
        originalFilename: file.originalFilename,
        attachmentFilename,
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

// SECURITY (0013): Alle Export-Target-Queries sind jetzt org-scoped.
// orgId ist required — Callers ohne aktive Org bekommen eine leere Liste,
// sodass kein Cross-Tenant-Read/Write mehr möglich ist.

export async function getExportTargets(orgId: string | null): Promise<ExportTargetConfig[]> {
  if (!orgId) return [];
  const rows = await sql<Array<Omit<ExportTargetConfig, "enabled"> & { enabled: boolean }>>`
    SELECT id, target, label, recipient_email AS "recipientEmail",
      smtp_slot AS "smtpSlot", enabled
    FROM export_targets
    WHERE organization_id = ${orgId}
    ORDER BY id ASC
  `;
  return rows.map((r) => ({ ...r, enabled: Boolean(r.enabled) }));
}

export async function saveExportTarget(
  orgId: string,
  target: string,
  recipientEmail: string | null,
  smtpSlot: SmtpCredentialOwnerId,
  enabled: boolean,
  skipExisting = false,
): Promise<void> {
  // UPSERT — pro (org, target) max. 1 Row (siehe uniq_export_targets_org_target).
  // Label = target ist ein Fallback, falls die Row noch nicht existiert; bei
  // bestehender Row bleibt das ursprüngliche Label erhalten.
  //
  // Aktivieren + (optionaler) Skip laufen ATOMAR in einer Transaktion: Sonst
  // könnte enqueueReadyInvoices zwischen "Target enabled" und "Skip gesetzt"
  // die Alt-Rechnungen enqueuen — der "nur neue"-Default würde unterlaufen.
  await sql.begin(async (tx) => {
    const db = tx as unknown as typeof sql;
    await db`
      INSERT INTO export_targets (organization_id, target, label, recipient_email, smtp_slot, enabled)
      VALUES (${orgId}, ${target}, ${target}, ${recipientEmail || null}, ${smtpSlot}, ${enabled})
      ON CONFLICT (organization_id, target) DO UPDATE SET
        recipient_email = excluded.recipient_email,
        smtp_slot = excluded.smtp_slot,
        enabled = excluded.enabled,
        updated_at = CURRENT_TIMESTAMP
    `;
    if (skipExisting) {
      await skipExistingInvoicesForTarget(orgId, target, db);
    }
  });
}

export async function getExportStats(): Promise<
  Array<{ targetLabel: string; status: string; count: number }>
> {
  const rows = await sql<Array<{ targetLabel: string; status: string; count: string }>>`
    SELECT export_targets.label AS "targetLabel", exports.status, COUNT(*) AS count
    FROM exports
    JOIN export_targets ON export_targets.id = exports.export_target_id
    GROUP BY export_targets.id, exports.status
  `;
  return rows.map((r) => ({ ...r, count: Number(r.count) }));
}
