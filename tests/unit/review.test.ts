import Database from "better-sqlite3";
import { describe, expect, it } from "vitest";
import { schemaStatements } from "@/lib/db/schema";
import { updateInvoiceReview } from "@/invoices/review";
import { seedDatabase } from "@/vendors/seed";

function createDb() {
  const db = new Database(":memory:");
  db.pragma("foreign_keys = ON");
  for (const statement of schemaStatements) {
    db.exec(statement);
  }
  seedDatabase(db);
  return db;
}

function getVendorId(db: Database.Database, canonicalKey: string) {
  return (
    db.prepare(`SELECT id FROM vendors WHERE canonical_key = ?`).get(canonicalKey) as { id: number } | undefined
  )?.id;
}

describe("invoice review", () => {
  it("updates invoice fields and marks the invoice as ready", () => {
    const db = createDb();
    const vendorId = getVendorId(db, "openai");
    const invoiceId = Number(
      db
        .prepare(
          `INSERT INTO invoices (vendor_id, source, status, invoice_number, invoice_date, amount_gross, currency, confidence)
           VALUES (NULL, 'mail', 'needs_review', NULL, NULL, NULL, NULL, 0.42)`,
        )
        .run().lastInsertRowid,
    );

    updateInvoiceReview(db, {
      invoiceId,
      vendorId: vendorId ?? null,
      invoiceNumber: "INV-2026-05",
      invoiceDate: "2026-05-01",
      servicePeriodStart: "2026-05-01",
      servicePeriodEnd: "2026-05-31",
      amountGross: 29,
      amountNet: 24.37,
      vatAmount: 4.63,
      currency: "EUR",
      status: "ready",
      duplicateOfInvoiceId: null,
      vatRate: 19,
      docType: "invoice",
    });

    const invoice = db
      .prepare(
        `SELECT vendor_id AS vendorId, status, invoice_number AS invoiceNumber, invoice_date AS invoiceDate,
          service_period_start AS servicePeriodStart, duplicate_of_invoice_id AS duplicateOfInvoiceId
         FROM invoices
         WHERE id = ?`,
      )
      .get(invoiceId) as {
      vendorId: number | null;
      status: string;
      invoiceNumber: string | null;
      invoiceDate: string | null;
      servicePeriodStart: string | null;
      duplicateOfInvoiceId: number | null;
    };

    expect(invoice).toMatchObject({
      vendorId,
      status: "ready",
      invoiceNumber: "INV-2026-05",
      invoiceDate: "2026-05-01",
      servicePeriodStart: "2026-05-01",
      duplicateOfInvoiceId: null,
    });
  });

  it("requires a target invoice when marking an invoice as duplicate", () => {
    const db = createDb();
    const invoiceId = Number(
      db
        .prepare(
          `INSERT INTO invoices (source, status, confidence)
           VALUES ('manual', 'needs_review', 0.2)`,
        )
        .run().lastInsertRowid,
    );

    expect(() =>
      updateInvoiceReview(db, {
        invoiceId,
        vendorId: null,
        invoiceNumber: null,
        invoiceDate: null,
        servicePeriodStart: null,
        servicePeriodEnd: null,
        amountGross: null,
        amountNet: null,
        vatAmount: null,
        currency: null,
        status: "duplicate",
        duplicateOfInvoiceId: null,
        vatRate: null,
        docType: null,
      }),
    ).toThrow("Bitte eine Zielrechnung für die Dublette auswählen.");
  });
});
