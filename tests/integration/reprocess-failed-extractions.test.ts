import { describe, expect, it } from "vitest";
import { reprocessNegativeAmountFailures } from "@/lib/automation/reprocess-failed-extractions";
import type { InvoiceAiExtraction } from "@/ai/schemas";
import { sql } from "@/lib/db/client";

// Gutschrift, die Mistral beim Re-Run liefert (negativer Betrag). Mit dem
// Schema-Fix (INFETCH-238) parst das jetzt — vor dem Fix scheiterte es mit
// too_small und der Beleg blieb ohne Betrag in needs_review.
const creditNote: InvoiceAiExtraction = {
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

// Seedet einen Beleg im Zustand "vor dem Fix gescheitert": needs_review,
// raw_text vorhanden, eine `failed`-ai_extraction mit too_small auf amount_gross.
async function seedFailedCreditNote(): Promise<number> {
  const rows = await sql<{ id: number }[]>`
    INSERT INTO invoices (source, status, confidence, dedupe_key, raw_text_path)
    VALUES (
      'manual', 'needs_review', 0,
      'reproc-' || md5(random()::text || clock_timestamp()::text),
      'reproc-raw-' || md5(random()::text || clock_timestamp()::text) || '.txt'
    )
    RETURNING id
  `;
  const id = rows[0].id;
  await sql`
    INSERT INTO ai_extractions (invoice_id, provider, model, prompt_version, input_hash, output_json, status, error)
    VALUES (
      ${id}, 'mistral', 'test-model', 'invoice-extraction-v1', 'seedhash-' || ${id}::text, NULL, 'failed',
      'ZodError [{"code":"too_small","minimum":0,"type":"number","path":["amount_gross"],"message":"Number must be greater than or equal to 0"}]'
    )
  `;
  return id;
}

const loadPdfText = async () =>
  "Microsoft Ireland Operations Ltd. Credit Note E0400Z4HWC Total -1.04 EUR";
const provider = async () => creditNote;

describe("reprocessNegativeAmountFailures", () => {
  it("heilt einen failed-Gutschrift-Beleg per frischer Extraktion (execute)", async () => {
    const invoiceId = await seedFailedCreditNote();

    const result = await reprocessNegativeAmountFailures({
      dryRun: false,
      provider,
      loadPdfText,
    });

    // Robust gegen andere DB-Inhalte: gezielt unseren Beleg prüfen.
    const detail = result.details.find((d) => d.invoiceId === invoiceId);
    expect(detail?.outcome).toBe("healed");

    const invoiceRows = await sql<{ amountGross: number | null; docType: string | null }[]>`
      SELECT amount_gross AS "amountGross", doc_type AS "docType"
      FROM invoices WHERE id = ${invoiceId}
    `;
    expect(invoiceRows[0].amountGross).toBeLessThan(0);
    expect(invoiceRows[0].amountGross).toBeCloseTo(-1.04, 2);
    expect(invoiceRows[0].docType).toBe("credit_note");

    const succeeded = await sql<{ c: string }[]>`
      SELECT COUNT(*) AS c FROM ai_extractions
      WHERE invoice_id = ${invoiceId} AND status = 'succeeded'
    `;
    expect(Number(succeeded[0].c)).toBeGreaterThanOrEqual(1);
  });

  it("dry-run zählt den Beleg, schreibt aber nichts und ruft Mistral nicht", async () => {
    const invoiceId = await seedFailedCreditNote();
    let providerCalls = 0;

    const result = await reprocessNegativeAmountFailures({
      dryRun: true,
      provider: async () => {
        providerCalls++;
        return creditNote;
      },
      loadPdfText,
    });

    const detail = result.details.find((d) => d.invoiceId === invoiceId);
    expect(detail?.outcome).toBe("would_reprocess");
    expect(providerCalls).toBe(0);

    // Beleg unverändert: kein Betrag, keine succeeded-Extraktion.
    const invoiceRows = await sql<{ amountGross: number | null }[]>`
      SELECT amount_gross AS "amountGross" FROM invoices WHERE id = ${invoiceId}
    `;
    expect(invoiceRows[0].amountGross).toBeNull();
    const succeeded = await sql<{ c: string }[]>`
      SELECT COUNT(*) AS c FROM ai_extractions
      WHERE invoice_id = ${invoiceId} AND status = 'succeeded'
    `;
    expect(Number(succeeded[0].c)).toBe(0);
  });
});
