import type Database from "better-sqlite3";
import { recordSyncEvent } from "@/lib/db/events";

const reviewStatuses = ["new", "needs_review", "ready", "ignored", "duplicate", "exported", "failed"] as const;

export type ReviewStatus = (typeof reviewStatuses)[number];

export type InvoiceReviewInput = {
  invoiceId: number;
  vendorId: number | null;
  invoiceNumber: string | null;
  invoiceDate: string | null;
  servicePeriodStart: string | null;
  servicePeriodEnd: string | null;
  amountGross: number | null;
  amountNet: number | null;
  vatAmount: number | null;
  currency: string | null;
  status: ReviewStatus;
  duplicateOfInvoiceId: number | null;
  vatRate: number | null;
  docType: string | null;
  preferredExportTargetId: number | null;
};

export function updateInvoiceReview(db: Database.Database, input: InvoiceReviewInput) {
  const current = db
    .prepare(
      `SELECT id, vendor_id AS vendorId, invoice_date AS invoiceDate, status
       FROM invoices
       WHERE id = ?`,
    )
    .get(input.invoiceId) as { id: number; vendorId: number | null; invoiceDate: string | null; status: string } | undefined;

  if (!current) {
    throw new Error("Rechnung wurde nicht gefunden.");
  }

  if (!reviewStatuses.includes(input.status)) {
    throw new Error("Ungültiger Review-Status.");
  }

  assertOptionalDate(input.invoiceDate, "Rechnungsdatum");
  assertOptionalDate(input.servicePeriodStart, "Leistungszeitraum Start");
  assertOptionalDate(input.servicePeriodEnd, "Leistungszeitraum Ende");

  if (input.servicePeriodStart && input.servicePeriodEnd && input.servicePeriodEnd < input.servicePeriodStart) {
    throw new Error("Leistungszeitraum Ende darf nicht vor dem Start liegen.");
  }

  if (input.vendorId !== null) {
    const vendor = db.prepare(`SELECT id FROM vendors WHERE id = ?`).get(input.vendorId) as { id: number } | undefined;
    if (!vendor) {
      throw new Error("Ausgewählter Vendor existiert nicht.");
    }
  }

  if (input.duplicateOfInvoiceId !== null) {
    if (input.duplicateOfInvoiceId === input.invoiceId) {
      throw new Error("Eine Rechnung kann nicht auf sich selbst als Dublette zeigen.");
    }
    const duplicateTarget = db
      .prepare(`SELECT id FROM invoices WHERE id = ?`)
      .get(input.duplicateOfInvoiceId) as { id: number } | undefined;
    if (!duplicateTarget) {
      throw new Error("Zielrechnung für die Dublette wurde nicht gefunden.");
    }
  }

  if (input.status === "duplicate" && input.duplicateOfInvoiceId === null) {
    throw new Error("Bitte eine Zielrechnung für die Dublette auswählen.");
  }

  if (input.status === "ready") {
    if (!input.vendorId || !input.invoiceDate || input.amountGross === null || !input.currency) {
      throw new Error("Für Exportbereit werden Lieferant, Rechnungsdatum, Betrag und Währung benötigt.");
    }
  }

  db.prepare(
    `UPDATE invoices
     SET vendor_id = ?, status = ?, invoice_number = ?, invoice_date = ?,
       service_period_start = ?, service_period_end = ?, amount_gross = ?,
       amount_net = ?, vat_amount = ?, currency = ?, duplicate_of_invoice_id = ?,
       vat_rate = ?, doc_type = ?, preferred_export_target_id = ?,
       updated_at = CURRENT_TIMESTAMP
     WHERE id = ?`,
  ).run(
    input.vendorId,
    input.status,
    input.invoiceNumber,
    input.invoiceDate,
    input.servicePeriodStart,
    input.servicePeriodEnd,
    input.amountGross,
    input.amountNet,
    input.vatAmount,
    input.currency,
    input.status === "duplicate" ? input.duplicateOfInvoiceId : null,
    input.vatRate,
    input.docType ?? "invoice",
    input.preferredExportTargetId,
    input.invoiceId,
  );

  recordSyncEvent(db, {
    level: "info",
    eventType: "invoice_review_updated",
    vendorId: input.vendorId ?? current.vendorId,
    invoiceId: input.invoiceId,
    yearMonth: input.invoiceDate?.slice(0, 7) ?? current.invoiceDate?.slice(0, 7) ?? null,
    message: `Rechnung wurde im Review aktualisiert (${input.status}).`,
    metadata: {
      previousStatus: current.status,
      nextStatus: input.status,
      duplicateOfInvoiceId: input.status === "duplicate" ? input.duplicateOfInvoiceId : null,
    },
  });
}

function assertOptionalDate(value: string | null, label: string) {
  if (!value) return;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw new Error(`${label} muss als YYYY-MM-DD gespeichert werden.`);
  }
}
