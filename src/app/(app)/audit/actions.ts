"use server";

import { revalidatePath } from "next/cache";
import { unsafeGlobalSql as sql } from "@/lib/db/unsafe-global";
import { syncStoredInvoiceFileNamesForInvoice } from "@/invoices/file-names";
import { importManualPdf } from "@/invoices/import-pipeline";
import { getCurrentAuth, requireCurrentAuth } from "@/lib/auth/current";
import { runMissingInvoiceCheck } from "@/invoices/missing-check";
import { updateInvoiceReview, type ReviewStatus } from "@/invoices/review";
import { learnFromManualMatch } from "@/vendors/auto-alias";
import { recordSyncEvent } from "@/lib/db/events";
import { blockSender } from "@/senders/discovered-senders";
import { appConfig } from "@/lib/config/env";

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
  // Manueller Upload ausgeblendet (Launch). Serverseitige Absicherung,
  // falls die Action doch aufgerufen wird.
  if (!appConfig.features.manualUpload) {
    return { status: "error", message: "Manueller Upload ist derzeit deaktiviert." };
  }

  const file = formData.get("invoicePdf");

  if (!(file instanceof File)) {
    return { status: "error", message: "Bitte eine PDF-Datei auswählen." };
  }

  const auth = await getCurrentAuth();
  const result = await importManualPdf({ file, organizationId: auth?.organization?.id ?? null });

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

  const auth = await requireCurrentAuth();
  const orgId = auth.organization?.id ?? null;

  if (!orgId) {
    return { status: "error", message: "Keine Organisation zugeordnet. Bitte neu anmelden." };
  }

  try {
    const invoiceId = Number(formData.get("invoiceId"));
    if (!Number.isInteger(invoiceId) || invoiceId <= 0) {
      return { status: "error", message: "Ungültige Rechnung ausgewählt." };
    }

    const intent = String(formData.get("intent") || "save");
    const statusFromForm = String(formData.get("reviewStatus") || "needs_review") as ReviewStatus;
    const status = resolveReviewStatus(intent, statusFromForm);

    const newVendorId = parseOptionalInteger(formData.get("vendorId"));
    const rows = await sql<{ vendorId: number | null }[]>`
      SELECT vendor_id AS "vendorId" FROM invoices
      WHERE id = ${invoiceId} AND organization_id = ${orgId}
    `;
    const previousVendorId = rows[0]?.vendorId ?? null;

    await updateInvoiceReview({
      organizationId: orgId,
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
    await syncStoredInvoiceFileNamesForInvoice(invoiceId);

    // Auto-Alias-Lernen: Wenn User einen Vendor neu zugeordnet hat, speichern wir
    // die Sender-Domain als Domain-Alias — damit kuenftige Mails vom selben
    // Sender automatisch matchen und nicht erneut im Review landen.
    if (newVendorId && newVendorId !== previousVendorId) {
      const result = await learnFromManualMatch({ invoiceId, vendorId: newVendorId, organizationId: orgId });
      if (result.learned) {
        await recordSyncEvent({
          level: "info",
          eventType: "vendor_alias_learned",
          invoiceId,
          vendorId: newVendorId,
          message: `Sender ${result.senderEmail} kuenftig automatisch zugeordnet (Domain: ${result.domain}).`,
          metadata: { domain: result.domain, senderEmail: result.senderEmail },
        });
      }
    }

    await runMissingInvoiceCheck();

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
  const auth = await requireCurrentAuth();
  const orgId = auth.organization?.id;
  if (!orgId) throw new Error("Keine Organisation zugeordnet.");
  await sql`
    UPDATE invoices SET is_private = TRUE
    WHERE id = ${invoiceId} AND organization_id = ${orgId}
  `;
  revalidatePath("/audit");
}

export async function restoreInvoiceFromPrivateAction(invoiceId: number): Promise<void> {
  const auth = await requireCurrentAuth();
  const orgId = auth.organization?.id;
  if (!orgId) throw new Error("Keine Organisation zugeordnet.");
  await sql`
    UPDATE invoices SET is_private = FALSE
    WHERE id = ${invoiceId} AND organization_id = ${orgId}
  `;
  revalidatePath("/audit");
}

export async function markSenderDomainPrivateAction(domain: string): Promise<void> {
  const auth = await requireCurrentAuth();
  const orgId = auth.organization?.id ?? null;
  const senders = await sql<Array<{ id: number }>>`
    SELECT id FROM discovered_senders
    WHERE from_domain = ${domain} AND blocked = FALSE
      AND organization_id IS NOT DISTINCT FROM ${orgId}
  `;
  for (const s of senders) {
    await blockSender(s.id, "Privat", orgId);
  }
  await sql`
    UPDATE invoices SET is_private = TRUE
    WHERE organization_id IS NOT DISTINCT FROM ${orgId}
      AND id IN (
        SELECT i.id FROM invoices i
        JOIN discovered_senders ds ON ds.matched_vendor_id = i.vendor_id
        WHERE ds.from_domain = ${domain}
          AND ds.organization_id IS NOT DISTINCT FROM ${orgId}
      )
  `;
  revalidatePath("/audit");
  revalidatePath("/senders");
}
