import { sql } from "@/lib/db/client";
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

export async function updateInvoiceReview(input: InvoiceReviewInput): Promise<void> {
  const currentRows = await sql<{ id: number; vendorId: number | null; invoiceDate: string | null; status: string }[]>`
    SELECT id, vendor_id AS "vendorId", invoice_date AS "invoiceDate", status
    FROM invoices
    WHERE id = ${input.invoiceId}
  `;
  const current = currentRows[0];

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
    const vendorRows = await sql`SELECT id FROM vendors WHERE id = ${input.vendorId}`;
    if (vendorRows.length === 0) {
      throw new Error("Ausgewählter Vendor existiert nicht.");
    }
  }

  if (input.duplicateOfInvoiceId !== null) {
    if (input.duplicateOfInvoiceId === input.invoiceId) {
      throw new Error("Eine Rechnung kann nicht auf sich selbst als Dublette zeigen.");
    }
    const dupRows = await sql`SELECT id FROM invoices WHERE id = ${input.duplicateOfInvoiceId}`;
    if (dupRows.length === 0) {
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

  await sql`
    UPDATE invoices
    SET vendor_id = ${input.vendorId},
        status = ${input.status},
        invoice_number = ${input.invoiceNumber},
        invoice_date = ${input.invoiceDate},
        service_period_start = ${input.servicePeriodStart},
        service_period_end = ${input.servicePeriodEnd},
        amount_gross = ${input.amountGross},
        amount_net = ${input.amountNet},
        vat_amount = ${input.vatAmount},
        currency = ${input.currency},
        duplicate_of_invoice_id = ${input.status === "duplicate" ? input.duplicateOfInvoiceId : null},
        vat_rate = ${input.vatRate},
        doc_type = ${input.docType ?? "invoice"},
        preferred_export_target_id = ${input.preferredExportTargetId},
        updated_at = CURRENT_TIMESTAMP
    WHERE id = ${input.invoiceId}
  `;

  await recordSyncEvent({
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
