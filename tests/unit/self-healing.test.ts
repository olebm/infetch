import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { sql } from "@/lib/db/client";
import { provisionAutoApprovalRules } from "@/lib/automation/self-provisioning";
import { reevaluateReviewQueue } from "@/lib/automation/reeval-queue";
import { escalateStuckReviews } from "@/lib/automation/stuck-escalation";
import { evaluateAutoApproval } from "@/lib/automation/auto-approval";
import { resolveInvoiceStatusFromAi } from "@/ai/extract-invoice";
import { isSenderAutoIgnored } from "@/senders/discovered-senders";
import { classifyFilenameAsJunk } from "@/invoices/filename-junk-filter";
import { backfillDomainAliases } from "@/lib/automation/alias-backfill";
import { isLocalExtractionSufficient } from "@/invoices/import-pipeline";
import type { InvoiceAiExtraction } from "@/ai/schemas";

// NOTE: All DB-touching tests now use the global postgres sql client.
// They require a real Postgres connection with seeded vendor data.

async function getVendorId(canonicalKey: string): Promise<number> {
  const rows = await sql<{ id: number }[]>`SELECT id FROM vendors WHERE canonical_key = ${canonicalKey}`;
  if (!rows[0]) throw new Error(`vendor ${canonicalKey} not seeded`);
  return rows[0].id;
}

async function insertInvoice(input: {
  vendorId: number;
  status: string;
  amount?: number | null;
  extraction?: Partial<InvoiceAiExtraction>;
}): Promise<number> {
  const dedupeKey = "dedupe-" + Math.random().toString(36).slice(2, 12);
  const rows = await sql<{ id: number }[]>`
    INSERT INTO invoices (vendor_id, source, status, invoice_number, invoice_date, amount_gross, currency, confidence, dedupe_key)
    VALUES (
      ${input.vendorId}, 'manual', ${input.status},
      ${"INV-" + Math.random().toString(36).slice(2, 10)},
      '2026-05-01',
      ${input.amount ?? 29},
      'EUR', 0.95, ${dedupeKey}
    )
    RETURNING id
  `;
  const invoiceId = rows[0].id;

  if (input.extraction) {
    const full: InvoiceAiExtraction = {
      document_type: "invoice",
      vendor: "Test",
      normalized_vendor: "test",
      invoice_number: "INV-1",
      invoice_date: "2026-05-01",
      service_period_start: null,
      service_period_end: null,
      amount_gross: input.amount ?? 29,
      amount_net: null,
      vat_amount: null,
      currency: "EUR",
      country: null,
      language: null,
      vendor_confidence: null,
      date_confidence: null,
      amount_confidence: null,
      confidence: 0.95,
      needs_review: false,
      review_reason: null,
      ...input.extraction,
    };
    await sql`
      INSERT INTO ai_extractions (invoice_id, provider, model, prompt_version, input_hash, output_json, status)
      VALUES (${invoiceId}, 'mistral', 'test-model', 'v1', ${"hash-" + invoiceId}, ${JSON.stringify(full)}, 'succeeded')
    `;
  }

  return invoiceId;
}

describe("provisionAutoApprovalRules", () => {
  beforeEach(async () => {
    // Remove leftover rules so NOT EXISTS check doesn't skip the vendor
    const openaiId = await sql<{ id: number }[]>`SELECT id FROM vendors WHERE canonical_key = 'openai'`;
    if (openaiId[0]) {
      await sql`DELETE FROM auto_approval_rules WHERE vendor_id = ${openaiId[0].id}`;
    }
  });
  afterEach(async () => {
    const openaiId = await sql<{ id: number }[]>`SELECT id FROM vendors WHERE canonical_key = 'openai'`;
    if (openaiId[0]) {
      await sql`DELETE FROM auto_approval_rules WHERE vendor_id = ${openaiId[0].id}`;
    }
  });

  it("creates a rule for a vendor with enough successful imports and no failures", async () => {
    const vendorId = await getVendorId("openai");
    await insertInvoice({ vendorId, status: "exported", amount: 20 });
    await insertInvoice({ vendorId, status: "exported", amount: 30 });
    await insertInvoice({ vendorId, status: "ready", amount: 25 });

    const result = await provisionAutoApprovalRules();

    expect(result.provisioned.length).toBeGreaterThanOrEqual(1);
    const openaiRule = result.provisioned.find((r) => r.vendorId === vendorId);
    expect(openaiRule).toBeTruthy();
  });

  it("is idempotent — does not duplicate when rule already exists", async () => {
    const vendorId = await getVendorId("openai");
    await insertInvoice({ vendorId, status: "exported", amount: 20 });
    await insertInvoice({ vendorId, status: "exported", amount: 30 });
    await insertInvoice({ vendorId, status: "ready", amount: 25 });

    await provisionAutoApprovalRules();
    const second = await provisionAutoApprovalRules();

    // Second run should not create duplicate rules for same vendor
    const dups = second.provisioned.filter((r) => r.vendorId === vendorId);
    expect(dups).toHaveLength(0);
  });
});

describe("reevaluateReviewQueue", () => {
  it("moves non-invoice documents from needs_review to ignored", async () => {
    const vendorId = await getVendorId("openai");
    const id = await insertInvoice({
      vendorId,
      status: "needs_review",
      extraction: { document_type: "other", review_reason: "AGB document" },
    });

    const result = await reevaluateReviewQueue();

    expect(result.ignored).toBeGreaterThanOrEqual(1);
    const rows = await sql<{ status: string }[]>`SELECT status FROM invoices WHERE id = ${id}`;
    expect(rows[0].status).toBe("ignored");
  });

  it("leaves invoices unchanged when extraction is missing or undecidable", async () => {
    const vendorId = await getVendorId("openai");
    const id = await insertInvoice({ vendorId, status: "needs_review", amount: null });

    await reevaluateReviewQueue();

    const rows = await sql<{ status: string }[]>`SELECT status FROM invoices WHERE id = ${id}`;
    expect(rows[0].status).toBe("needs_review");
  });
});

describe("auto-approval per-field-confidence fallback", () => {
  it("approves via high_confidence when per-field is null but top-level >= threshold", async () => {
    const vendorId = await getVendorId("openai");

    const decision = await evaluateAutoApproval(
      {
        document_type: "invoice",
        vendor: "OpenAI",
        normalized_vendor: "openai",
        invoice_number: "INV-1",
        invoice_date: "2026-05-01",
        service_period_start: null,
        service_period_end: null,
        amount_gross: 29,
        amount_net: null,
        vat_amount: null,
        currency: "EUR",
        country: null,
        language: null,
        vendor_confidence: null,
        date_confidence: null,
        amount_confidence: null,
        confidence: 0.95,
        needs_review: false,
        review_reason: null,
      },
      { organizationId: null, vendorId, vendorName: "OpenAI", amountGross: 29, invoiceDate: "2026-05-01" },
    );

    expect(decision.autoApproved).toBe(true);
  });

  it("falls back to rejection when per-field is null and top-level below threshold", async () => {
    const vendorId = await getVendorId("openai");

    const decision = await evaluateAutoApproval(
      {
        document_type: "invoice",
        vendor: "OpenAI",
        normalized_vendor: "openai",
        invoice_number: "INV-1",
        invoice_date: "2026-05-01",
        service_period_start: null,
        service_period_end: null,
        amount_gross: 29,
        amount_net: null,
        vat_amount: null,
        currency: "EUR",
        country: null,
        language: null,
        vendor_confidence: null,
        date_confidence: null,
        amount_confidence: null,
        confidence: 0.8,
        needs_review: false,
        review_reason: null,
      },
      { organizationId: null, vendorId, vendorName: "OpenAI", amountGross: 29, invoiceDate: "2026-05-01" },
    );

    expect(decision.autoApproved).toBe(false);
  });
});

describe("resolveInvoiceStatusFromAi (non-invoice routing)", () => {
  it("returns 'ignored' for document_type='other'", () => {
    const status = resolveInvoiceStatusFromAi(
      {
        document_type: "other",
        vendor: "x",
        normalized_vendor: null,
        invoice_number: null,
        invoice_date: null,
        service_period_start: null,
        service_period_end: null,
        amount_gross: null,
        amount_net: null,
        vat_amount: null,
        currency: null,
        country: null,
        language: null,
        vendor_confidence: null,
        date_confidence: null,
        amount_confidence: null,
        confidence: 0.95,
        needs_review: true,
        review_reason: null,
      },
      { vendorId: 1, invoiceDate: null, amountGross: null },
    );

    expect(status).toBe("ignored");
  });

  it("returns 'needs_review' for low-confidence invoices", () => {
    const status = resolveInvoiceStatusFromAi(
      {
        document_type: "invoice",
        vendor: "x",
        normalized_vendor: null,
        invoice_number: "INV-1",
        invoice_date: "2026-05-01",
        service_period_start: null,
        service_period_end: null,
        amount_gross: 29,
        amount_net: null,
        vat_amount: null,
        currency: "EUR",
        country: null,
        language: null,
        vendor_confidence: null,
        date_confidence: null,
        amount_confidence: null,
        confidence: 0.6,
        needs_review: false,
        review_reason: null,
      },
      { vendorId: 1, invoiceDate: "2026-05-01", amountGross: 29 },
    );

    expect(status).toBe("needs_review");
  });
});

describe("escalateStuckReviews", () => {
  it("escalates needs_review invoices older than the configured threshold", async () => {
    const vendorId = await getVendorId("openai");
    const dkOld = "dk-old-" + Date.now();
    await sql`
      INSERT INTO invoices (vendor_id, source, status, invoice_number, invoice_date, amount_gross, currency, dedupe_key, updated_at)
      VALUES (${vendorId}, 'manual', 'needs_review', 'INV-OLD', '2026-01-01', 50, 'EUR', ${dkOld}, NOW() - INTERVAL '60 days')
    `;

    const result = await escalateStuckReviews();

    expect(result.escalated).toBeGreaterThanOrEqual(1);
    const rows = await sql<{ status: string }[]>`SELECT status FROM invoices WHERE dedupe_key = ${dkOld}`;
    expect(rows[0].status).toBe("ignored");
  });

  it("leaves fresh needs_review invoices untouched", async () => {
    const vendorId = await getVendorId("openai");
    const dkNew = "dk-new-" + Date.now();
    await sql`
      INSERT INTO invoices (vendor_id, source, status, invoice_number, invoice_date, amount_gross, currency, dedupe_key)
      VALUES (${vendorId}, 'manual', 'needs_review', 'INV-NEW', '2026-05-01', 50, 'EUR', ${dkNew})
    `;

    const before = await escalateStuckReviews();
    void before;

    const rows = await sql<{ status: string }[]>`SELECT status FROM invoices WHERE dedupe_key = ${dkNew}`;
    expect(rows[0].status).toBe("needs_review");
  });
});

describe("isSenderAutoIgnored", () => {
  it("returns false when address is empty", async () => {
    expect(await isSenderAutoIgnored(null, null)).toBe(false);
  });
});

describe("classifyFilenameAsJunk", () => {
  it("matches obvious non-invoice filenames", () => {
    expect(classifyFilenameAsJunk("Widerrufsbelehrung.pdf").isJunk).toBe(true);
    expect(classifyFilenameAsJunk("AGB-2026.pdf").isJunk).toBe(true);
    expect(classifyFilenameAsJunk("boarding-pass-DLH123.pdf").isJunk).toBe(true);
    expect(classifyFilenameAsJunk("terms_of_service.pdf").isJunk).toBe(true);
    expect(classifyFilenameAsJunk("AV-Vertrag-Mistral.pdf").isJunk).toBe(true);
  });

  it("does not match legitimate invoice filenames", () => {
    expect(classifyFilenameAsJunk("Rechnung-2026-04-Hetzner.pdf").isJunk).toBe(false);
    expect(classifyFilenameAsJunk("Invoice-1QSTFKNA-0005.pdf").isJunk).toBe(false);
    expect(classifyFilenameAsJunk("Receipt-2767.pdf").isJunk).toBe(false);
    expect(classifyFilenameAsJunk(null).isJunk).toBe(false);
  });
});

describe("isLocalExtractionSufficient (relaxed threshold)", () => {
  it("accepts a contains-match (0.72) when amount and date are present", () => {
    const result = isLocalExtractionSufficient(
      0.72,
      { invoiceDate: "2026-05-01", amountGross: 29 },
      { error: null },
      0.85,
    );
    expect(result).toBe(true);
  });

  it("rejects when vendor confidence too low", () => {
    const result = isLocalExtractionSufficient(
      0.5,
      { invoiceDate: "2026-05-01", amountGross: 29 },
      { error: null },
      0.85,
    );
    expect(result).toBe(false);
  });

  it("rejects when core field missing", () => {
    const result = isLocalExtractionSufficient(
      0.9,
      { invoiceDate: null, amountGross: 29 },
      { error: null },
      0.85,
    );
    expect(result).toBe(false);
  });
});

describe("backfillDomainAliases", () => {
  it("runs without error", async () => {
    const result = await backfillDomainAliases();
    expect(result).toHaveProperty("aliasesAdded");
    expect(result).toHaveProperty("details");
  });
});
