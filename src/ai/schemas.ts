import { z } from "zod";

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const confidenceScore = z.number().min(0).max(1).nullable();

export const invoiceAiExtractionSchema = z
  .object({
    document_type: z.enum(["invoice", "receipt", "payment_confirmation", "credit_note", "other"]),
    vendor: z.string().nullable(),
    normalized_vendor: z.string().nullable(),
    invoice_number: z.string().nullable(),
    invoice_date: isoDate.nullable(),
    service_period_start: isoDate.nullable(),
    service_period_end: isoDate.nullable(),
    // Beträge dürfen negativ sein: Gutschriften/Rückerstattungen/Negativ-
    // Korrekturen (z. B. Microsoft Credit Note, invoice_number E0400Z4HWC,
    // -1,04 €) liefern legitim negative Werte. Der frühere .nonnegative()-Guard
    // ließ Zod hier mit too_small scheitern → Extraktion 'failed' → Beleg ohne
    // Betrag/Vendor in needs_review (Datenverlust). Die Wire-JSON-Schema unten
    // (nullableNumber) erlaubt Negative bereits — beide Schemas bleiben so synchron.
    amount_gross: z.number().nullable(),
    amount_net: z.number().nullable(),
    vat_amount: z.number().nullable(),
    currency: z.string().length(3).nullable(),
    country: z.string().length(2).nullable(),
    language: z.string().min(2).max(12).nullable(),
    confidence: z.number().min(0).max(1),
    amount_confidence: confidenceScore,
    date_confidence: confidenceScore,
    vendor_confidence: confidenceScore,
    vat_rate_confidence: confidenceScore.optional(),
    doc_type_confidence: confidenceScore.optional(),
    needs_review: z.boolean(),
    review_reason: z.string().nullable(),
  })
  .strict();

export type InvoiceAiExtraction = z.infer<typeof invoiceAiExtractionSchema>;

const nullableString = { anyOf: [{ type: "string" }, { type: "null" }] };
const nullableNumber = { anyOf: [{ type: "number" }, { type: "null" }] };
const nullableIsoDate = {
  anyOf: [{ type: "string", pattern: "^\\d{4}-\\d{2}-\\d{2}$" }, { type: "null" }],
};

const nullableConfidence = {
  anyOf: [{ type: "number", minimum: 0, maximum: 1 }, { type: "null" }],
};

export const invoiceAiExtractionJsonSchema = {
  type: "object",
  additionalProperties: false,
  required: [
    "document_type",
    "vendor",
    "normalized_vendor",
    "invoice_number",
    "invoice_date",
    "service_period_start",
    "service_period_end",
    "amount_gross",
    "amount_net",
    "vat_amount",
    "currency",
    "country",
    "language",
    "confidence",
    "amount_confidence",
    "date_confidence",
    "vendor_confidence",
    "needs_review",
    "review_reason",
  ],
  properties: {
    document_type: { enum: ["invoice", "receipt", "payment_confirmation", "credit_note", "other"] },
    vendor: nullableString,
    normalized_vendor: nullableString,
    invoice_number: nullableString,
    invoice_date: nullableIsoDate,
    service_period_start: nullableIsoDate,
    service_period_end: nullableIsoDate,
    amount_gross: nullableNumber,
    amount_net: nullableNumber,
    vat_amount: nullableNumber,
    currency: { anyOf: [{ type: "string", minLength: 3, maxLength: 3 }, { type: "null" }] },
    country: { anyOf: [{ type: "string", minLength: 2, maxLength: 2 }, { type: "null" }] },
    language: { anyOf: [{ type: "string", minLength: 2, maxLength: 12 }, { type: "null" }] },
    confidence: { type: "number", minimum: 0, maximum: 1 },
    amount_confidence: nullableConfidence,
    date_confidence: nullableConfidence,
    vendor_confidence: nullableConfidence,
    vat_rate_confidence: nullableConfidence,
    doc_type_confidence: nullableConfidence,
    needs_review: { type: "boolean" },
    review_reason: nullableString,
  },
} satisfies Record<string, unknown>;
