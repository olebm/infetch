"use server";

import { revalidatePath } from "next/cache";
import { syncStoredInvoiceFileNamesForInvoice } from "@/invoices/file-names";
import { importManualPdf } from "@/invoices/import-pipeline";
import { runMissingInvoiceCheck } from "@/invoices/missing-check";
import { updateInvoiceReview, type ReviewStatus } from "@/invoices/review";
import { getDb } from "@/lib/db/client";
import { learnFromManualMatch } from "@/vendors/auto-alias";
import { recordSyncEvent } from "@/lib/db/events";
import { blockSender } from "@/senders/discovered-senders";

export type ManualImportState = {
  status: "idle" | "success" | "duplicate" | "error";
  message: string;
};

export type InvoiceReviewState = {
  status: "idle" | "success" | "error";
  message: string;
};

export async function importManualPdfAction(
  _previousState: ManualImportState,
  formData: FormData,
): Promise<ManualImportState> {
  const file = formData.get("invoicePdf");

  if (!(file instanceof File)) {
    return { status: "error", message: "Bitte eine PDF-Datei auswählen." };
  }

  const result = await importManualPdf({ file });

  revalidatePath("/");
  revalidatePath("/audit");
  revalidatePath("/fehlt");

  if (!result.ok) {
    return { status: "error", message: result.message };
  }

  return {
    status: result.status === "duplicate" ? "duplicate" : "success",
    message: result.message,
  };
}

export async function updateInvoiceReviewAction(
  _previousState: InvoiceReviewState,
  formData: FormData,
): Promise<InvoiceReviewState> {
  void _previousState;

  try {
    const invoiceId = Number(formData.get("invoiceId"));
    if (!Number.isInteger(invoiceId) || invoiceId <= 0) {
      return { status: "error", message: "Ungültige Rechnung ausgewählt." };
    }

    const intent = String(formData.get("intent") || "save");
    const statusFromForm = String(formData.get("reviewStatus") || "needs_review") as ReviewStatus;
    const status = resolveReviewStatus(intent, statusFromForm);
    const db = getDb();

    const newVendorId = parseOptionalInteger(formData.get("vendorId"));
    const previousVendorId = (
      db.prepare(`SELECT vendor_id AS vendorId FROM invoices WHERE id = ?`).get(invoiceId) as
        | { vendorId: number | null }
        | undefined
    )?.vendorId ?? null;

    updateInvoiceReview(db, {
      invoiceId,
      vendorId: newVendorId,
      invoiceNumber: parseOptionalString(formData.get("invoiceNumber")),
      invoiceDate: parseOptionalString(formData.get("invoiceDate")),
      servicePeriodStart: parseOptionalString(formData.get("servicePeriodStart")),
      servicePeriodEnd: parseOptionalString(formData.get("servicePeriodEnd")),
      amountGross: parseOptionalNumber(formData.get("amountGross")),
      amountNet: parseOptionalNumber(formData.get("amountNet")),
      vatAmount: parseOptionalNumber(formData.get("vatAmount")),
      currency: normalizeCurrency(formData.get("currency")),
      status,
      duplicateOfInvoiceId: parseOptionalInteger(formData.get("duplicateOfInvoiceId")),
      vatRate: parseOptionalNumber(formData.get("vatRate")),
      docType: parseOptionalString(formData.get("docType")),
      preferredExportTargetId: parseOptionalInteger(formData.get("exportTargetId")),
    });
    syncStoredInvoiceFileNamesForInvoice(invoiceId, db);

    // Auto-Alias-Lernen: Wenn User einen Vendor neu zugeordnet hat, speichern wir
    // die Sender-Domain als Domain-Alias — damit kuenftige Mails vom selben
    // Sender automatisch matchen und nicht erneut im Review landen.
    if (newVendorId && newVendorId !== previousVendorId) {
      const result = learnFromManualMatch(db, { invoiceId, vendorId: newVendorId });
      if (result.learned) {
        recordSyncEvent(db, {
          level: "info",
          eventType: "vendor_alias_learned",
          invoiceId,
          vendorId: newVendorId,
          message: `Sender ${result.senderEmail} kuenftig automatisch zugeordnet (Domain: ${result.domain}).`,
          metadata: { domain: result.domain, senderEmail: result.senderEmail },
        });
      }
    }

    runMissingInvoiceCheck(db);

    revalidatePath("/");
    revalidatePath("/audit");
    revalidatePath(`/audit/${invoiceId}`);
    revalidatePath("/fehlt");

    return {
      status: "success",
      message: getReviewSuccessMessage(status),
    };
  } catch (error) {
    return {
      status: "error",
      message: error instanceof Error ? error.message : "Review konnte nicht gespeichert werden.",
    };
  }
}

const ALL_DB_STATUSES = new Set<string>([
  "new", "needs_review", "ready", "ignored", "duplicate", "exported", "failed",
]);

function resolveReviewStatus(intent: string, currentStatus: string): ReviewStatus {
  if (intent === "mark_ready") return "ready";
  if (intent === "mark_ignored") return "ignored";
  if (intent === "mark_duplicate") return "duplicate";
  // "save" intent: preserve the current DB status as-is (including exported/failed for metadata edits)
  return ALL_DB_STATUSES.has(currentStatus) ? (currentStatus as ReviewStatus) : "needs_review";
}

function parseOptionalString(value: FormDataEntryValue | null) {
  const normalized = String(value || "").trim();
  return normalized ? normalized : null;
}

function parseOptionalInteger(value: FormDataEntryValue | null) {
  const normalized = String(value || "").trim();
  if (!normalized) return null;
  const parsed = Number(normalized);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
}

function parseOptionalNumber(value: FormDataEntryValue | null) {
  const normalized = String(value || "").trim().replace(",", ".");
  if (!normalized) return null;
  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : null;
}

function normalizeCurrency(value: FormDataEntryValue | null) {
  const normalized = String(value || "").trim().toUpperCase();
  return normalized ? normalized.slice(0, 8) : null;
}

function getReviewSuccessMessage(status: ReviewStatus) {
  if (status === "ready") return "Rechnung wurde gespeichert und als exportbereit markiert.";
  if (status === "ignored") return "Rechnung wurde gespeichert und ignoriert.";
  if (status === "duplicate") return "Rechnung wurde als Dublette gespeichert.";
  return "Review wurde gespeichert.";
}

// ─── Privat markieren ────────────────────────────────────────────────────────

export async function markInvoicePrivateAction(invoiceId: number): Promise<void> {
  const db = getDb();
  db.prepare(`UPDATE invoices SET is_private = 1 WHERE id = ?`).run(invoiceId);
  revalidatePath("/audit");
}

export async function restoreInvoiceFromPrivateAction(invoiceId: number): Promise<void> {
  const db = getDb();
  db.prepare(`UPDATE invoices SET is_private = 0 WHERE id = ?`).run(invoiceId);
  revalidatePath("/audit");
}

export async function markSenderDomainPrivateAction(domain: string): Promise<void> {
  const db = getDb();
  // Block all discovered_senders matching this domain
  const senders = db
    .prepare(`SELECT id FROM discovered_senders WHERE from_domain = ? AND blocked = 0`)
    .all(domain) as Array<{ id: number }>;
  for (const s of senders) {
    blockSender(db, s.id, "Privat");
  }
  // Also mark all existing invoices from this domain as private
  db.prepare(
    `UPDATE invoices SET is_private = 1
     WHERE id IN (
       SELECT i.id FROM invoices i
       JOIN discovered_senders ds ON ds.matched_vendor_id = i.vendor_id
       WHERE ds.from_domain = ?
     )`,
  ).run(domain);
  revalidatePath("/audit");
  revalidatePath("/senders");
}
