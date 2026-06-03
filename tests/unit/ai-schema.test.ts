import { describe, expect, it } from "vitest";
import { invoiceAiExtractionSchema, invoiceAiExtractionJsonSchema } from "@/ai/schemas";

// Vollständige, gültige Basis-Extraktion. Einzelne Tests überschreiben gezielt
// die Betragsfelder. Pur (keine DB) — testet ausschließlich das Zod-/Wire-Schema.
const base = {
  document_type: "credit_note" as const,
  vendor: "Microsoft Ireland Operations Ltd.",
  normalized_vendor: "microsoft",
  invoice_number: "E0400Z4HWC",
  invoice_date: "2026-01-15",
  service_period_start: null,
  service_period_end: null,
  amount_gross: -1.04,
  amount_net: -0.84,
  vat_amount: -0.2,
  currency: "EUR",
  country: "IE",
  language: "en",
  confidence: 0.97,
  amount_confidence: 0.98,
  date_confidence: 0.97,
  vendor_confidence: 0.99,
  needs_review: false,
  review_reason: null,
};

describe("invoiceAiExtractionSchema – negative Beträge (Gutschriften)", () => {
  it("parst eine Gutschrift mit negativem amount_gross/amount_net/vat_amount", () => {
    // Regression INFETCH: vorher warf Zod hier `too_small` ("Number must be
    // greater than or equal to 0") → Extraktion failed → Datenverlust
    // (Prod: Microsoft Credit Note E0400Z4HWC, -1,04 €).
    const parsed = invoiceAiExtractionSchema.parse({
      ...base,
      amount_gross: -1.04,
      amount_net: -0.84,
      vat_amount: -0.2,
    });
    expect(parsed.amount_gross).toBe(-1.04);
    expect(parsed.amount_net).toBe(-0.84);
    expect(parsed.vat_amount).toBe(-0.2);
  });

  it("parst weiterhin positive Beträge und null", () => {
    expect(
      invoiceAiExtractionSchema.parse({ ...base, document_type: "invoice", amount_gross: 5.2 })
        .amount_gross,
    ).toBe(5.2);
    const allNull = invoiceAiExtractionSchema.parse({
      ...base,
      amount_gross: null,
      amount_net: null,
      vat_amount: null,
    });
    expect(allNull.amount_gross).toBeNull();
    expect(allNull.amount_net).toBeNull();
    expect(allNull.vat_amount).toBeNull();
  });

  it("bleibt chirurgisch: out-of-range confidence schlägt weiterhin fehl", () => {
    // Beweist, dass nur die Vorzeichen-Grenze fiel — andere Constraints stehen.
    expect(() => invoiceAiExtractionSchema.parse({ ...base, confidence: 1.5 })).toThrow();
  });

  it("Wire-JSON-Schema (an Mistral) erlaubt Negative — kein minimum auf Betragsfeldern", () => {
    // Schützt davor, dass jemand versehentlich ein `minimum: 0` in die
    // an Mistral gesendete Schema-Definition einbaut und den Fix aushebelt.
    for (const field of ["amount_gross", "amount_net", "vat_amount"] as const) {
      expect(invoiceAiExtractionJsonSchema.properties[field]).toEqual({
        anyOf: [{ type: "number" }, { type: "null" }],
      });
    }
  });
});
