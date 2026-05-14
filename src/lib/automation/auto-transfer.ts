import path from "node:path";
import type Database from "better-sqlite3";
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

function loadInvoiceForTransfer(db: Database.Database, invoiceId: number): InvoiceForTransfer | null {
  const row = db
    .prepare(
      `SELECT invoices.id, invoices.status, invoices.external_ref AS externalRef,
              invoices.invoice_date AS invoiceDate, vendors.name AS vendorName
       FROM invoices
       LEFT JOIN vendors ON vendors.id = invoices.vendor_id
       WHERE invoices.id = ?`,
    )
    .get(invoiceId) as InvoiceForTransfer | undefined;
  return row ?? null;
}

function loadInvoiceFile(db: Database.Database, invoiceId: number): InvoiceFileRef | null {
  const row = db
    .prepare(
      `SELECT stored_path AS storedPath, original_filename AS originalFilename
       FROM invoice_files
       WHERE invoice_id = ?
       ORDER BY created_at DESC, id DESC
       LIMIT 1`,
    )
    .get(invoiceId) as InvoiceFileRef | undefined;
  return row ?? null;
}

/**
 * Auto-Transfer für eine 'ready'-Rechnung: prüft, ob eine Integration aktiv ist,
 * und pusht das PDF an die Steuersoftware. Idempotent — überspringt, wenn
 * external_ref bereits gesetzt ist.
 */
export async function attemptAutoTransfer(
  db: Database.Database,
  invoiceId: number,
): Promise<{ pushed: boolean; provider?: IntegrationProvider; externalRef?: string; reason?: string }> {
  if (!appConfig.features.enableApiIntegrations) {
    return { pushed: false, reason: "api integrations disabled" };
  }
  const invoice = loadInvoiceForTransfer(db, invoiceId);
  if (!invoice) return { pushed: false, reason: "invoice not found" };
  if (invoice.status !== "ready") return { pushed: false, reason: "status not ready" };
  if (invoice.externalRef) return { pushed: false, reason: "already transferred" };

  const integration = getActiveIntegrationTarget(db);
  if (!integration) return { pushed: false, reason: "no active integration" };

  const file = loadInvoiceFile(db, invoiceId);
  if (!file) {
    recordSyncEvent(db, {
      level: "warning",
      eventType: "auto_transfer_skipped",
      invoiceId,
      message: "Auto-Transfer übersprungen: kein PDF gefunden.",
      metadata: { provider: integration.provider },
    });
    return { pushed: false, reason: "no PDF file" };
  }

  try {
    const apiKey = await readCredentialSecret({ scope: integration.provider });
    if (!apiKey) {
      recordSyncEvent(db, {
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
    if (integration.provider === "lexoffice") {
      const result = await uploadLexofficeFileToInbox(apiKey, file.storedPath, filename);
      externalId = result.id;
    } else if (integration.provider === "sevdesk") {
      const tempFile = await uploadSevdeskTempFile(apiKey, file.storedPath, filename);
      const voucher = await createSevdeskVoucherFromTempFile(apiKey, tempFile, {
        voucherDate: invoice.invoiceDate,
        description: invoice.vendorName ? `Import: ${invoice.vendorName}` : "Auto-Import via Infetch",
      });
      externalId = voucher.id;
    } else {
      return { pushed: false, reason: `provider ${integration.provider} not implemented` };
    }

    recordInvoiceExternalRef(invoiceId, externalId, integration.provider, db);
    db.prepare(
      `UPDATE invoices SET status = 'exported', updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
    ).run(invoiceId);

    recordSyncEvent(db, {
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
    recordSyncEvent(db, {
      level: "error",
      eventType: "auto_transfer_failed",
      invoiceId,
      message: `Auto-Transfer an ${integration.provider} fehlgeschlagen: ${message}`,
      metadata: { provider: integration.provider, error: message },
    });
    return { pushed: false, reason: message };
  }
}
