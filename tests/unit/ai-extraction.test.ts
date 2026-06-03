import { describe, expect, it } from "vitest";
import {
  buildInvoiceExtractionPayload,
  createInvoiceExtractionInputHash,
  runInvoiceAiExtraction,
} from "@/ai/extract-invoice";
import { invoiceAiExtractionSchema, type InvoiceAiExtraction } from "@/ai/schemas";
import { sql } from "@/lib/db/client";

// NOTE: runInvoiceAiExtraction now uses the global postgres sql client.
// Tests that create/read invoices require a real Postgres connection.

const validExtraction: InvoiceAiExtraction = {
  document_type: "invoice",
  vendor: "OpenAI Ireland Ltd.",
  normalized_vendor: "openai",
  invoice_number: "INV-2026-001",
  // Vergangenheits-Datum (clock-robust): sonst könnte der neue Plausibilitäts-
  // Guard (Zukunfts-Datum → needs_review) die status='ready'-Assertion kippen.
  invoice_date: "2023-05-01",
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

// Gutschrift / Credit Note mit negativen Beträgen. Vor dem Schema-Fix scheiterte
// invoiceAiExtractionSchema.parse() hier mit `too_small` → status 'failed',
// Beleg ohne Betrag in needs_review (Prod: Microsoft E0400Z4HWC, -1,04 €).
const creditNoteExtraction: InvoiceAiExtraction = {
  document_type: "credit_note",
  vendor: "Microsoft Ireland Operations Ltd.",
  normalized_vendor: "microsoft",
  invoice_number: "E0400Z4HWC",
  invoice_date: "2023-05-01",
  service_period_start: null,
  service_period_end: null,
  amount_gross: -1.04,
  amount_net: -0.87,
  vat_amount: -0.17,
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

async function insertInvoice(): Promise<number> {
  const rows = await sql<{ id: number }[]>`
    INSERT INTO invoices (source, status, confidence, dedupe_key)
    VALUES ('manual', 'needs_review', 0.4, 'hash-' || extract(epoch from now())::text)
    RETURNING id
  `;
  return rows[0].id;
}

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
    expect(createInvoiceExtractionInputHash(payload)).toBe(
      createInvoiceExtractionInputHash(payload),
    );
  });

  it("accepts negative amounts for credit notes (Gutschriften)", () => {
    // Regressions-Guard: zuvor verbot `.nonnegative()` negative Beträge,
    // wodurch jede Gutschrift an der Extraktion scheiterte (Prod-Bug E0400Z4HWC).
    const creditNote: InvoiceAiExtraction = {
      ...validExtraction,
      document_type: "credit_note",
      invoice_number: "E0400Z4HWC",
      amount_gross: -1.04,
      amount_net: -1.04,
      vat_amount: 0,
    };
    expect(() => invoiceAiExtractionSchema.parse(creditNote)).not.toThrow();
    expect(invoiceAiExtractionSchema.parse(creditNote).amount_gross).toBe(-1.04);
  });

  it("records a succeeded AI audit row and applies validated fields to the invoice", async () => {
    const invoiceId = await insertInvoice();
    const result = await runInvoiceAiExtraction(
      {
        invoiceId,
        organizationId: null,
        originalFilename: "openai.pdf",
        pdfText: "OpenAI Ireland Ltd. Invoice INV-2026-001 Total 23 EUR",
        localParsed: { invoiceNumber: null, invoiceDate: null, amountGross: null, currency: null },
        localVendorKey: null,
      },
      async () => validExtraction,
    );

    const invoiceRows = await sql<
      {
        status: string;
        invoiceNumber: string | null;
        amountGross: number | null;
        vendorKey: string;
      }[]
    >`
      SELECT invoices.status, invoices.invoice_number AS "invoiceNumber", invoices.amount_gross AS "amountGross",
        vendors.canonical_key AS "vendorKey"
      FROM invoices
      JOIN vendors ON vendors.id = invoices.vendor_id
      WHERE invoices.id = ${invoiceId}
    `;
    const invoice = invoiceRows[0];
    const aiRows = await sql<{ status: string; outputJson: string }[]>`
      SELECT status, output_json AS "outputJson" FROM ai_extractions WHERE invoice_id = ${invoiceId}
    `;
    const aiRow = aiRows[0];

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
    const invoiceId = await insertInvoice();
    let calls = 0;
    const provider = async () => {
      calls += 1;
      return validExtraction;
    };
    const input = {
      invoiceId,
      organizationId: null,
      originalFilename: "openai.pdf",
      pdfText: "OpenAI Ireland Ltd. Invoice INV-2026-001 Total 23 EUR",
      localParsed: { invoiceNumber: null, invoiceDate: null, amountGross: null, currency: null },
      localVendorKey: null,
    };

    await runInvoiceAiExtraction(input, provider);
    const second = await runInvoiceAiExtraction(input, provider);

    expect(second.status).toBe("cached");
    expect(calls).toBe(1);
  });

  it("erfasst eine Gutschrift mit negativem amount_gross (statt 'failed') und persistiert das Vorzeichen", async () => {
    const invoiceId = await insertInvoice();
    const result = await runInvoiceAiExtraction(
      {
        invoiceId,
        organizationId: null,
        originalFilename: "microsoft-credit-note.pdf",
        pdfText: "Microsoft Ireland Operations Ltd. Credit Note E0400Z4HWC Total -1.04 EUR",
        localParsed: { invoiceNumber: null, invoiceDate: null, amountGross: null, currency: null },
        localVendorKey: null,
      },
      async () => creditNoteExtraction,
    );

    // Vor dem Fix scheiterte invoiceAiExtractionSchema.parse() in
    // runInvoiceAiExtraction mit too_small → status 'failed', kein Betrag.
    expect(result.status).toBe("succeeded");

    const invoiceRows = await sql<{ amountGross: number | null; docType: string | null }[]>`
      SELECT amount_gross AS "amountGross", doc_type AS "docType"
      FROM invoices WHERE id = ${invoiceId}
    `;
    // amount_gross ist REAL → Vorzeichen + ~2 Nachkommastellen prüfen (nicht toBe).
    expect(invoiceRows[0].amountGross).toBeLessThan(0);
    expect(invoiceRows[0].amountGross).toBeCloseTo(-1.04, 2);
    expect(invoiceRows[0].docType).toBe("credit_note");

    const aiRows = await sql<{ status: string; outputJson: string }[]>`
      SELECT status, output_json AS "outputJson" FROM ai_extractions WHERE invoice_id = ${invoiceId}
    `;
    expect(aiRows[0].status).toBe("succeeded");
    // output_json ist Text-JSON → exakter Vergleich möglich.
    expect(JSON.parse(aiRows[0].outputJson).amount_gross).toBe(-1.04);
  });
});
