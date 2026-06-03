import { describe, expect, it } from "vitest";
import { evaluateAutoApproval } from "@/lib/automation/auto-approval";
import type { InvoiceAiExtraction } from "@/ai/schemas";

// NOTE: evaluateAutoApproval now uses the global postgres sql client.
// These tests require a real Postgres connection (DATABASE_URL env var).
// The vendorId=1 assumes the default seeded "openai" vendor exists.

const VENDOR_ID = 1; // seeded openai vendor

function buildExtraction(overrides: Partial<InvoiceAiExtraction>): InvoiceAiExtraction {
  return {
    document_type: "invoice",
    vendor: "OpenAI",
    normalized_vendor: "openai",
    invoice_number: "INV-1",
    invoice_date: "2026-05-01",
    service_period_start: null,
    service_period_end: null,
    amount_gross: 29,
    amount_net: 24.37,
    vat_amount: 4.63,
    currency: "EUR",
    country: null,
    language: null,
    vendor_confidence: 0.99,
    date_confidence: 0.99,
    amount_confidence: 0.99,
    confidence: 0.99,
    needs_review: false,
    review_reason: null,
    ...overrides,
  };
}

describe("evaluateAutoApproval", () => {
  it("auto-approves via high_confidence when all fields exceed threshold (no rule needed)", async () => {
    const decision = await evaluateAutoApproval(
      buildExtraction({ vendor_confidence: 0.95, date_confidence: 0.95, amount_confidence: 0.95 }),
      {
        organizationId: null,
        vendorId: VENDOR_ID,
        vendorName: "OpenAI",
        amountGross: 29,
        invoiceDate: "2026-05-01",
      },
    );

    expect(decision.autoApproved).toBe(true);
    if (decision.autoApproved) {
      expect(decision.via).toBe("high_confidence");
      expect(decision.ruleId).toBeNull();
    }
  });

  it("rejects when one per-field confidence dips below the auto-pilot threshold and no rule exists", async () => {
    const decision = await evaluateAutoApproval(buildExtraction({ amount_confidence: 0.8 }), {
      organizationId: null,
      vendorId: VENDOR_ID,
      vendorName: "OpenAI",
      amountGross: 29,
      invoiceDate: "2026-05-01",
    });

    expect(decision.autoApproved).toBe(false);
  });

  it("rejects when mistral flagged needs_review even at high confidence", async () => {
    const decision = await evaluateAutoApproval(buildExtraction({ needs_review: true }), {
      organizationId: null,
      vendorId: VENDOR_ID,
      vendorName: "OpenAI",
      amountGross: 29,
      invoiceDate: "2026-05-01",
    });

    expect(decision.autoApproved).toBe(false);
    if (!decision.autoApproved) {
      expect(decision.reason).toMatch(/needs_review/);
    }
  });

  it("rejects when core fields are missing", async () => {
    const decision = await evaluateAutoApproval(buildExtraction({}), {
      organizationId: null,
      vendorId: VENDOR_ID,
      vendorName: "OpenAI",
      amountGross: null,
      invoiceDate: "2026-05-01",
    });

    expect(decision.autoApproved).toBe(false);
  });
});
