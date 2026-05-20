import path from "node:path";
import { unsafeGlobalSql as sql } from "@/lib/db/unsafe-global";
import { recordSyncEvent } from "@/lib/db/events";
import {
  getActiveIntegrationTarget,
  recordInvoiceExternalRef,
  type IntegrationProvider,
} from "@/lib/db/queries";
import { readCredentialSecret } from "@/lib/secrets/credential-store";
import { uploadLexofficeFileToInbox, LexofficeApiError } from "@/lib/integrations/lexoffice-client";
import {
  uploadSevdeskTempFile,
  createSevdeskVoucherFromTempFile,
  SevdeskApiError,
} from "@/lib/integrations/sevdesk-client";
import { appConfig } from "@/lib/config/env";
import { BUCKETS, downloadFromStorage } from "@/lib/supabase/storage";

type InvoiceForTransfer = {
  id: number;
  status: string;
  externalRef: string | null;
  invoiceDate: string | null;
  vendorName: string | null;
};

type InvoiceFileRef = {
  storedPath: string;
  originalFilename: string;
};

async function loadInvoiceForTransfer(
  invoiceId: number,
  organizationId: string | null,
): Promise<InvoiceForTransfer | null> {
  const rows = await sql<InvoiceForTransfer[]>`
    SELECT invoices.id, invoices.status, invoices.external_ref AS "externalRef",
           invoices.invoice_date AS "invoiceDate", vendors.name AS "vendorName"
    FROM invoices
    LEFT JOIN vendors ON vendors.id = invoices.vendor_id
    WHERE invoices.id = ${invoiceId}
      ${organizationId ? sql`AND invoices.organization_id = ${organizationId}` : sql``}
  `;
  return rows[0] ?? null;
}

async function loadInvoiceFile(invoiceId: number): Promise<InvoiceFileRef | null> {
  const rows = await sql<InvoiceFileRef[]>`
    SELECT stored_path AS "storedPath", original_filename AS "originalFilename"
    FROM invoice_files
    WHERE invoice_id = ${invoiceId}
    ORDER BY created_at DESC, id DESC
    LIMIT 1
  `;
  return rows[0] ?? null;
}

/**
 * Auto-Transfer für eine 'ready'-Rechnung: prüft, ob eine Integration aktiv ist,
 * und pusht das PDF an die Steuersoftware. Idempotent — überspringt, wenn
 * external_ref bereits gesetzt ist.
 */
export async function attemptAutoTransfer(
  invoiceId: number,
  organizationId?: string | null,
): Promise<{ pushed: boolean; provider?: IntegrationProvider; externalRef?: string; reason?: string }> {
  if (!appConfig.features.enableApiIntegrations) {
    return { pushed: false, reason: "api integrations disabled" };
  }
  const invoice = await loadInvoiceForTransfer(invoiceId, organizationId ?? null);
  if (!invoice) return { pushed: false, reason: "invoice not found" };
  if (invoice.status !== "ready") return { pushed: false, reason: "status not ready" };
  if (invoice.externalRef) return { pushed: false, reason: "already transferred" };

  const integration = await getActiveIntegrationTarget(organizationId ?? null);
  if (!integration) return { pushed: false, reason: "no active integration" };

  const file = await loadInvoiceFile(invoiceId);
  if (!file) {
    await recordSyncEvent({
      level: "warning",
      eventType: "auto_transfer_skipped",
      invoiceId,
      message: "Auto-Transfer übersprungen: kein PDF gefunden.",
      metadata: { provider: integration.provider },
    });
    return { pushed: false, reason: "no PDF file" };
  }

  try {
    const apiKey = await readCredentialSecret({
      scope: integration.provider,
      organizationId: organizationId ?? null,
    });
    if (!apiKey) {
      await recordSyncEvent({
        level: "warning",
        eventType: "auto_transfer_skipped",
        invoiceId,
        message: `Auto-Transfer übersprungen: ${integration.provider}-API-Key fehlt.`,
        metadata: { provider: integration.provider },
      });
      return { pushed: false, reason: "missing api key" };
    }

    let externalId: string;
    const filename = path.basename(file.originalFilename || file.storedPath);
    // stored_path ist ein Supabase-Storage-Key — Inhalt vor Transfer laden.
    const pdfContent = await downloadFromStorage(BUCKETS.INVOICES, file.storedPath);
    if (integration.provider === "lexoffice") {
      const result = await uploadLexofficeFileToInbox(apiKey, pdfContent, filename);
      externalId = result.id;
    } else if (integration.provider === "sevdesk") {
      const tempFile = await uploadSevdeskTempFile(apiKey, pdfContent, filename);
      const voucher = await createSevdeskVoucherFromTempFile(apiKey, tempFile, {
        voucherDate: invoice.invoiceDate,
        description: invoice.vendorName ? `Import: ${invoice.vendorName}` : "Auto-Import via Infetch",
      });
      externalId = voucher.id;
    } else {
      return { pushed: false, reason: `provider ${integration.provider} not implemented` };
    }

    await recordInvoiceExternalRef(invoiceId, externalId, integration.provider);
    await sql`
      UPDATE invoices SET status = 'exported', updated_at = CURRENT_TIMESTAMP WHERE id = ${invoiceId}
    `;

    await recordSyncEvent({
      level: "info",
      eventType: "auto_transfer_succeeded",
      invoiceId,
      message: `An ${integration.provider} übertragen (Beleg-ID: ${externalId}).`,
      metadata: { provider: integration.provider, externalRef: externalId },
    });

    return { pushed: true, provider: integration.provider, externalRef: externalId };
  } catch (error) {
    const message =
      error instanceof LexofficeApiError || error instanceof SevdeskApiError
        ? error.message
        : error instanceof Error
          ? error.message
          : String(error);
    await recordSyncEvent({
      level: "error",
      eventType: "auto_transfer_failed",
      invoiceId,
      message: `Auto-Transfer an ${integration.provider} fehlgeschlagen: ${message}`,
      metadata: { provider: integration.provider, error: message },
    });
    return { pushed: false, reason: message };
  }
}
