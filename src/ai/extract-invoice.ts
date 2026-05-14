import crypto from "node:crypto";
import type Database from "better-sqlite3";
import { appConfig } from "@/lib/config/env";
import { recordSyncEvent } from "@/lib/db/events";
import { hasConfiguredCredential } from "@/lib/secrets/credential-store";
import { matchVendor } from "@/vendors/matcher";
import { callAiExtract } from "@/ai/proxy-client";
import { invoiceExtractionPromptVersion, maxInvoiceExtractionTextChars } from "@/ai/prompt-versions";
import { invoiceAiExtractionSchema, type InvoiceAiExtraction } from "@/ai/schemas";
import { evaluateAutoApproval } from "@/lib/automation/auto-approval";

type LocalParsedInvoice = {
  invoiceNumber: string | null;
  invoiceDate: string | null;
  amountGross: number | null;
  currency: string | null;
};

type CandidateVendor = {
  canonicalKey: string;
  name: string;
  aliases: string[];
};

export type InvoiceAiProvider = (request: {
  model: string;
  promptPayload: Record<string, unknown>;
}) => Promise<InvoiceAiExtraction>;

export type InvoiceAiRunResult =
  | { status: "succeeded"; inputHash: string; extraction: InvoiceAiExtraction }
  | { status: "cached"; inputHash: string; extraction: InvoiceAiExtraction }
  | { status: "skipped"; inputHash: string; reason: string }
  | { status: "failed"; inputHash: string; error: string };

export async function runInvoiceAiExtraction(
  db: Database.Database,
  input: {
    invoiceId: number;
    originalFilename: string;
    pdfText: string;
    localParsed: LocalParsedInvoice;
    localVendorKey: string | null;
  },
  provider?: InvoiceAiProvider,
): Promise<InvoiceAiRunResult> {
  const candidates = getAiCandidateVendors(db);
  const promptPayload = buildInvoiceExtractionPayload(input, candidates);
  const inputHash = createInvoiceExtractionInputHash(promptPayload);
  const model = appConfig.mistral.model;
  const existing = getExistingExtraction(db, input.invoiceId, inputHash);

  if (existing?.status === "succeeded" && existing.outputJson) {
    const parsed = parseStoredExtraction(existing.outputJson);
    if (parsed) {
      applyAiExtractionToInvoice(db, input.invoiceId, parsed);
      return { status: "cached", inputHash, extraction: parsed };
    }
  }

  // KI ist verfügbar wenn:
  //   - Test-Provider übergeben (Mocks), ODER
  //   - externer Proxy via AI_PROXY_URL konfiguriert (Backend-Proxy bedient sich seines eigenen Key), ODER
  //   - lokaler Mistral-Key vorhanden (DB-credential für BYOK ODER env MISTRAL_API_KEY für Self-Host)
  const canUseMistral =
    Boolean(provider) ||
    Boolean(appConfig.aiProxy.url) ||
    (appConfig.mistral.enabled &&
      (hasConfiguredCredential(db, "mistral") || appConfig.mistral.configured));
  if (!canUseMistral) {
    const reason = appConfig.mistral.enabled
      ? "Kein Mistral-Key konfiguriert (weder lokal noch via AI-Proxy)."
      : "Mistral AI ist deaktiviert.";
    upsertAiExtraction(db, {
      invoiceId: input.invoiceId,
      model,
      inputHash,
      status: "skipped",
      error: reason,
      outputJson: null,
    });
    recordSyncEvent(db, {
      level: "warning",
      eventType: "mistral_extraction_skipped",
      invoiceId: input.invoiceId,
      message: reason,
      metadata: { inputHash, promptVersion: invoiceExtractionPromptVersion },
    });
    return { status: "skipped", inputHash, reason };
  }

  if (!input.pdfText.trim() && !appConfig.mistral.sendPdfBinary) {
    const reason = "Kein extrahierter PDF-Text für Mistral vorhanden.";
    upsertAiExtraction(db, {
      invoiceId: input.invoiceId,
      model,
      inputHash,
      status: "skipped",
      error: reason,
      outputJson: null,
    });
    recordSyncEvent(db, {
      level: "warning",
      eventType: "mistral_extraction_skipped",
      invoiceId: input.invoiceId,
      message: reason,
      metadata: { inputHash, promptVersion: invoiceExtractionPromptVersion },
    });
    return { status: "skipped", inputHash, reason };
  }

  upsertAiExtraction(db, {
    invoiceId: input.invoiceId,
    model,
    inputHash,
    status: "pending",
    error: null,
    outputJson: null,
  });

  try {
    const extractor: InvoiceAiProvider =
      provider ||
      (async () => {
        const result = await callAiExtract({
          pdfText: input.pdfText,
          originalFilename: input.originalFilename,
          localParsed: input.localParsed,
          localVendorKey: input.localVendorKey,
          model,
        });
        return result.extraction;
      });
    const extraction = invoiceAiExtractionSchema.parse(await extractor({ model, promptPayload }));
    upsertAiExtraction(db, {
      invoiceId: input.invoiceId,
      model,
      inputHash,
      status: "succeeded",
      error: null,
      outputJson: JSON.stringify(extraction),
    });
    applyAiExtractionToInvoice(db, input.invoiceId, extraction);
    recordSyncEvent(db, {
      level: "info",
      eventType: "mistral_extraction_succeeded",
      invoiceId: input.invoiceId,
      message: "Mistral AI Analyse abgeschlossen.",
      metadata: { inputHash, promptVersion: invoiceExtractionPromptVersion, confidence: extraction.confidence },
    });
    return { status: "succeeded", inputHash, extraction };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Mistral extraction failed";
    upsertAiExtraction(db, {
      invoiceId: input.invoiceId,
      model,
      inputHash,
      status: "failed",
      error: message,
      outputJson: null,
    });
    recordSyncEvent(db, {
      level: "error",
      eventType: "mistral_extraction_failed",
      invoiceId: input.invoiceId,
      message: "Mistral AI Analyse fehlgeschlagen.",
      metadata: { inputHash, promptVersion: invoiceExtractionPromptVersion, error: message },
    });
    return { status: "failed", inputHash, error: message };
  }
}

export function buildInvoiceExtractionPayload(
  input: {
    originalFilename: string;
    pdfText: string;
    localParsed: LocalParsedInvoice;
    localVendorKey: string | null;
  },
  candidateVendors: CandidateVendor[],
) {
  return {
    prompt_version: invoiceExtractionPromptVersion,
    original_filename: input.originalFilename,
    local_parser: input.localParsed,
    local_vendor_key: input.localVendorKey,
    candidate_vendors: candidateVendors,
    pdf_text: input.pdfText.slice(0, maxInvoiceExtractionTextChars),
  };
}

export function createInvoiceExtractionInputHash(payload: Record<string, unknown>) {
  return crypto.createHash("sha256").update(JSON.stringify(payload)).digest("hex");
}

function getAiCandidateVendors(db: Database.Database): CandidateVendor[] {
  const vendors = db
    .prepare(
      `SELECT id, name, canonical_key AS canonicalKey
       FROM vendors
       ORDER BY name COLLATE NOCASE`,
    )
    .all() as Array<{ id: number; name: string; canonicalKey: string }>;

  const aliases = db
    .prepare(
      `SELECT vendor_id AS vendorId, alias
       FROM vendor_aliases
       ORDER BY priority ASC, alias ASC`,
    )
    .all() as Array<{ vendorId: number; alias: string }>;

  const aliasesByVendor = new Map<number, string[]>();
  for (const alias of aliases) {
    const values = aliasesByVendor.get(alias.vendorId) || [];
    values.push(alias.alias);
    aliasesByVendor.set(alias.vendorId, values);
  }

  return vendors.map((vendor) => ({
    canonicalKey: vendor.canonicalKey,
    name: vendor.name,
    aliases: aliasesByVendor.get(vendor.id) || [],
  }));
}

function getExistingExtraction(db: Database.Database, invoiceId: number, inputHash: string) {
  return db
    .prepare(
      `SELECT status, output_json AS outputJson, error
       FROM ai_extractions
       WHERE invoice_id = ? AND provider = 'mistral' AND prompt_version = ? AND input_hash = ?`,
    )
    .get(invoiceId, invoiceExtractionPromptVersion, inputHash) as
    | { status: string; outputJson: string | null; error: string | null }
    | undefined;
}

function parseStoredExtraction(outputJson: string) {
  const parsed = invoiceAiExtractionSchema.safeParse(JSON.parse(outputJson));
  return parsed.success ? parsed.data : null;
}

function upsertAiExtraction(
  db: Database.Database,
  input: {
    invoiceId: number;
    model: string;
    inputHash: string;
    outputJson: string | null;
    status: "pending" | "succeeded" | "failed" | "skipped";
    error: string | null;
  },
) {
  db.prepare(
    `INSERT INTO ai_extractions (
      invoice_id, provider, model, prompt_version, input_hash, output_json, status, error
    )
    VALUES (?, 'mistral', ?, ?, ?, ?, ?, ?)
    ON CONFLICT(invoice_id, provider, prompt_version, input_hash) DO UPDATE SET
      model = excluded.model,
      output_json = excluded.output_json,
      status = excluded.status,
      error = excluded.error`,
  ).run(input.invoiceId, input.model, invoiceExtractionPromptVersion, input.inputHash, input.outputJson, input.status, input.error);
}

function applyAiExtractionToInvoice(db: Database.Database, invoiceId: number, extraction: InvoiceAiExtraction) {
  const current = db
    .prepare(
      `SELECT vendor_id AS vendorId, invoice_number AS invoiceNumber, invoice_date AS invoiceDate,
        service_period_start AS servicePeriodStart, service_period_end AS servicePeriodEnd,
        amount_gross AS amountGross, amount_net AS amountNet, vat_amount AS vatAmount,
        currency, confidence
       FROM invoices
       WHERE id = ?`,
    )
    .get(invoiceId) as
    | {
        vendorId: number | null;
        invoiceNumber: string | null;
        invoiceDate: string | null;
        servicePeriodStart: string | null;
        servicePeriodEnd: string | null;
        amountGross: number | null;
        amountNet: number | null;
        vatAmount: number | null;
        currency: string | null;
        confidence: number | null;
      }
    | undefined;

  if (!current) return;

  const vendorId = resolveAiVendorId(db, extraction) ?? current.vendorId;
  const invoiceNumber = extraction.invoice_number || current.invoiceNumber;
  const invoiceDate = extraction.invoice_date || current.invoiceDate;
  const amountGross = extraction.amount_gross ?? current.amountGross;
  const amountNet = extraction.amount_net ?? current.amountNet;
  const vatAmount = extraction.vat_amount ?? current.vatAmount;
  const currency = extraction.currency || current.currency;
  const confidence = Math.max(current.confidence ?? 0, extraction.confidence);
  let status = resolveInvoiceStatusFromAi(extraction, {
    vendorId,
    invoiceDate,
    amountGross,
  });

  if (status !== "ready") {
    const decision = evaluateAutoApproval(db, extraction, {
      vendorId,
      vendorName: extraction.vendor,
      amountGross,
      invoiceDate,
    });
    if (decision.autoApproved) {
      status = "ready";
      recordSyncEvent(db, {
        level: "info",
        eventType: "auto_approval_applied",
        invoiceId,
        message:
          decision.via === "high_confidence"
            ? "Auto-Pilot: hohe Konfidenz — Rechnung direkt als bereit markiert."
            : "Auto-Approval gegriffen — Rechnung direkt als bereit markiert.",
        metadata: {
          via: decision.via,
          ruleId: decision.ruleId,
          amountGross,
          amountConfidence: extraction.amount_confidence,
          dateConfidence: extraction.date_confidence,
          vendorConfidence: extraction.vendor_confidence,
        },
      });
    }
  }

  // Map AI document_type → doc_type column (credit_note + receipt are distinct; everything else → invoice)
  const docType =
    extraction.document_type === "credit_note" ? "credit_note"
    : extraction.document_type === "receipt"   ? "receipt"
    : "invoice";

  db.prepare(
    `UPDATE invoices
     SET vendor_id = ?, status = ?, invoice_number = ?, invoice_date = ?,
       service_period_start = ?, service_period_end = ?, amount_gross = ?,
       amount_net = ?, vat_amount = ?, currency = ?, confidence = ?,
       doc_type = ?,
       updated_at = CURRENT_TIMESTAMP
     WHERE id = ?`,
  ).run(
    vendorId,
    status,
    invoiceNumber,
    invoiceDate,
    extraction.service_period_start || current.servicePeriodStart,
    extraction.service_period_end || current.servicePeriodEnd,
    amountGross,
    amountNet,
    vatAmount,
    currency,
    Number(confidence.toFixed(2)),
    docType,
    invoiceId,
  );
}

function resolveAiVendorId(db: Database.Database, extraction: InvoiceAiExtraction) {
  const canonicalKey = normalizeCanonicalKey(extraction.normalized_vendor);
  if (canonicalKey) {
    const direct = db
      .prepare(`SELECT id FROM vendors WHERE canonical_key = ?`)
      .get(canonicalKey) as { id: number } | undefined;
    if (direct) return direct.id;
  }

  const match = matchVendor(db, [extraction.normalized_vendor || "", extraction.vendor || ""]);
  return match.vendorId;
}

function normalizeCanonicalKey(value: string | null) {
  if (!value) return null;
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

export function resolveInvoiceStatusFromAi(
  extraction: InvoiceAiExtraction,
  input: { vendorId: number | null; invoiceDate: string | null; amountGross: number | null },
) {
  const isInvoiceLike = ["invoice", "receipt", "payment_confirmation", "credit_note"].includes(extraction.document_type);
  // Wenn KI das PDF klar als Nicht-Rechnung erkennt (AGB, Widerrufsbelehrung,
  // Boarding-Pass, Vertrag, etc.) → 'ignored'. Würde sonst die Review-Queue
  // mit nicht-aktionablen Items verstopfen.
  if (!isInvoiceLike) return "ignored";
  if (extraction.needs_review || extraction.confidence < 0.75) return "needs_review";
  if (!input.vendorId || !input.invoiceDate || input.amountGross === null) return "needs_review";
  return "ready";
}
