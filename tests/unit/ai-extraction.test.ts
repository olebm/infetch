import Database from "better-sqlite3";
import { describe, expect, it } from "vitest";
import { buildInvoiceExtractionPayload, createInvoiceExtractionInputHash, runInvoiceAiExtraction } from "@/ai/extract-invoice";
import type { InvoiceAiExtraction } from "@/ai/schemas";
import { schemaStatements } from "@/lib/db/schema";
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

function insertInvoice(db: Database.Database) {
  return Number(
    db
      .prepare(
        `INSERT INTO invoices (source, status, confidence, dedupe_key)
         VALUES ('manual', 'needs_review', 0.4, 'hash')`,
      )
      .run().lastInsertRowid,
  );
}

const validExtraction: InvoiceAiExtraction = {
  document_type: "invoice",
  vendor: "OpenAI Ireland Ltd.",
  normalized_vendor: "openai",
  invoice_number: "INV-2026-001",
  invoice_date: "2026-05-01",
  service_period_start: null,
  service_period_end: null,
  amount_gross: 23,
  amount_net: null,
  vat_amount: null,
  currency: "EUR",
  country: "IE",
  language: "en",
  confidence: 0.96,
  amount_confidence: 0.98,
  date_confidence: 0.97,
  vendor_confidence: 0.99,
  needs_review: false,
  review_reason: null,
};

describe("Mistral invoice extraction pipeline", () => {
  it("builds stable hashes from minimized prompt payloads", () => {
    const payload = buildInvoiceExtractionPayload(
      {
        originalFilename: "openai.pdf",
        pdfText: "Invoice text",
        localParsed: { invoiceNumber: null, invoiceDate: null, amountGross: null, currency: null },
        localVendorKey: null,
      },
      [{ canonicalKey: "openai", name: "OpenAI", aliases: ["OpenAI Ireland Ltd."] }],
    );

    expect(payload).not.toHaveProperty("stored_path");
    expect(createInvoiceExtractionInputHash(payload)).toBe(createInvoiceExtractionInputHash(payload));
  });

  it("records a succeeded AI audit row and applies validated fields to the invoice", async () => {
    const db = createDb();
    const invoiceId = insertInvoice(db);
    const result = await runInvoiceAiExtraction(
      db,
      {
        invoiceId,
        originalFilename: "openai.pdf",
        pdfText: "OpenAI Ireland Ltd. Invoice INV-2026-001 Total 23 EUR",
        localParsed: { invoiceNumber: null, invoiceDate: null, amountGross: null, currency: null },
        localVendorKey: null,
      },
      async () => validExtraction,
    );

    const invoice = db
      .prepare(
        `SELECT invoices.status, invoices.invoice_number AS invoiceNumber, invoices.amount_gross AS amountGross,
          vendors.canonical_key AS vendorKey
         FROM invoices
         JOIN vendors ON vendors.id = invoices.vendor_id
         WHERE invoices.id = ?`,
      )
      .get(invoiceId) as { status: string; invoiceNumber: string; amountGross: number; vendorKey: string };
    const aiRow = db
      .prepare(`SELECT status, output_json AS outputJson FROM ai_extractions WHERE invoice_id = ?`)
      .get(invoiceId) as { status: string; outputJson: string };

    expect(result.status).toBe("succeeded");
    expect(invoice).toMatchObject({
      status: "ready",
      invoiceNumber: "INV-2026-001",
      amountGross: 23,
      vendorKey: "openai",
    });
    expect(aiRow.status).toBe("succeeded");
    expect(JSON.parse(aiRow.outputJson).confidence).toBe(0.96);
  });

  it("uses the local AI cache for the same input hash", async () => {
    const db = createDb();
    const invoiceId = insertInvoice(db);
    let calls = 0;
    const provider = async () => {
      calls += 1;
      return validExtraction;
    };
    const input = {
      invoiceId,
      originalFilename: "openai.pdf",
      pdfText: "OpenAI Ireland Ltd. Invoice INV-2026-001 Total 23 EUR",
      localParsed: { invoiceNumber: null, invoiceDate: null, amountGross: null, currency: null },
      localVendorKey: null,
    };

    await runInvoiceAiExtraction(db, input, provider);
    const second = await runInvoiceAiExtraction(db, input, provider);

    expect(second.status).toBe("cached");
    expect(calls).toBe(1);
  });
});
