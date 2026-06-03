import crypto from "node:crypto";
import { unsafeGlobalSql as sql } from "@/lib/db/unsafe-global";
import { appConfig } from "@/lib/config/env";
import { recordSyncEvent } from "@/lib/db/events";
import { hasConfiguredCredential } from "@/lib/secrets/credential-store";
import { matchVendor } from "@/vendors/matcher";
import { callAiExtract } from "@/ai/proxy-client";
import { invoiceExtractionPromptVersion, maxInvoiceExtractionTextChars } from "@/ai/prompt-versions";
import { invoiceAiExtractionSchema, type InvoiceAiExtraction } from "@/ai/schemas";
import { evaluateAutoApproval } from "@/lib/automation/auto-approval";
import { isExtractionPlausible } from "@/invoices/plausibility";

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
  input: {
    invoiceId: number;
    organizationId: string | null;
    originalFilename: string;
    pdfText: string;
    localParsed: LocalParsedInvoice;
    localVendorKey: string | null;
  },
  provider?: InvoiceAiProvider,
): Promise<InvoiceAiRunResult> {
  const candidates = await getAiCandidateVendors();
  const promptPayload = buildInvoiceExtractionPayload(input, candidates);
  const inputHash = createInvoiceExtractionInputHash(promptPayload);
  const model = appConfig.mistral.model;
  const existing = await getExistingExtraction(input.invoiceId, inputHash);

  if (existing?.status === "succeeded" && existing.outputJson) {
    const parsed = parseStoredExtraction(existing.outputJson);
    if (parsed) {
      await applyAiExtractionToInvoice(input.invoiceId, input.organizationId, parsed);
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
      ((await hasConfiguredCredential("mistral")) || appConfig.mistral.configured));
  if (!canUseMistral) {
    const reason = appConfig.mistral.enabled
      ? "Kein Mistral-Key konfiguriert (weder lokal noch via AI-Proxy)."
      : "Mistral AI ist deaktiviert.";
    await upsertAiExtraction({
      invoiceId: input.invoiceId,
      model,
      inputHash,
      status: "skipped",
      error: reason,
      outputJson: null,
    });
    await recordSyncEvent({
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
    await upsertAiExtraction({
      invoiceId: input.invoiceId,
      model,
      inputHash,
      status: "skipped",
      error: reason,
      outputJson: null,
    });
    await recordSyncEvent({
      level: "warning",
      eventType: "mistral_extraction_skipped",
      invoiceId: input.invoiceId,
      message: reason,
      metadata: { inputHash, promptVersion: invoiceExtractionPromptVersion },
    });
    return { status: "skipped", inputHash, reason };
  }

  await upsertAiExtraction({
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
    await upsertAiExtraction({
      invoiceId: input.invoiceId,
      model,
      inputHash,
      status: "succeeded",
      error: null,
      outputJson: JSON.stringify(extraction),
    });
    await applyAiExtractionToInvoice(input.invoiceId, input.organizationId, extraction);
    await recordSyncEvent({
      level: "info",
      eventType: "mistral_extraction_succeeded",
      invoiceId: input.invoiceId,
      message: "Mistral AI Analyse abgeschlossen.",
      metadata: { inputHash, promptVersion: invoiceExtractionPromptVersion, confidence: extraction.confidence },
    });
    return { status: "succeeded", inputHash, extraction };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Mistral extraction failed";
    await upsertAiExtraction({
      invoiceId: input.invoiceId,
      model,
      inputHash,
      status: "failed",
      error: message,
      outputJson: null,
    });
    await recordSyncEvent({
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

async function getAiCandidateVendors(): Promise<CandidateVendor[]> {
  const vendors = await sql<Array<{ id: number; name: string; canonicalKey: string }>>`
    SELECT id, name, canonical_key AS "canonicalKey"
    FROM vendors
    ORDER BY name
  `;

  const aliases = await sql<Array<{ vendorId: number; alias: string }>>`
    SELECT vendor_id AS "vendorId", alias
    FROM vendor_aliases
    ORDER BY priority ASC, alias ASC
  `;

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

async function getExistingExtraction(invoiceId: number, inputHash: string) {
  const rows = await sql<{ status: string; outputJson: string | null; error: string | null }[]>`
    SELECT status, output_json AS "outputJson", error
    FROM ai_extractions
    WHERE invoice_id = ${invoiceId} AND provider = 'mistral' AND prompt_version = ${invoiceExtractionPromptVersion} AND input_hash = ${inputHash}
  `;
  return rows[0];
}

function parseStoredExtraction(outputJson: string) {
  const parsed = invoiceAiExtractionSchema.safeParse(JSON.parse(outputJson));
  return parsed.success ? parsed.data : null;
}

async function upsertAiExtraction(input: {
  invoiceId: number;
  model: string;
  inputHash: string;
  outputJson: string | null;
  status: "pending" | "succeeded" | "failed" | "skipped";
  error: string | null;
}): Promise<void> {
  await sql`
    INSERT INTO ai_extractions (
      invoice_id, provider, model, prompt_version, input_hash, output_json, status, error
    )
    VALUES (${input.invoiceId}, 'mistral', ${input.model}, ${invoiceExtractionPromptVersion}, ${input.inputHash}, ${input.outputJson}, ${input.status}, ${input.error})
    ON CONFLICT(invoice_id, provider, prompt_version, input_hash) DO UPDATE SET
      model = excluded.model,
      output_json = excluded.output_json,
      status = excluded.status,
      error = excluded.error
  `;
}

async function applyAiExtractionToInvoice(
  invoiceId: number,
  organizationId: string | null,
  extraction: InvoiceAiExtraction,
): Promise<void> {
  const currentRows = await sql<{
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
  }[]>`
    SELECT vendor_id AS "vendorId", invoice_number AS "invoiceNumber", invoice_date AS "invoiceDate",
      service_period_start AS "servicePeriodStart", service_period_end AS "servicePeriodEnd",
      amount_gross AS "amountGross", amount_net AS "amountNet", vat_amount AS "vatAmount",
      currency, confidence
    FROM invoices
    WHERE id = ${invoiceId}
  `;
  const current = currentRows[0];
  if (!current) return;

  // Observability: wo weicht der lokale Parser von der KI ab? Hilft, die lokale
  // Extraktion gezielt zu härten (statt blind zu raten). `current` hält hier
  // noch die LOKALEN Werte (vor dem AI-UPDATE) → echter Lokal-vs-KI-Vergleich.
  const mismatches = collectLocalVsAiMismatches(current, extraction);
  if (mismatches.length > 0) {
    await recordSyncEvent({
      level: "info",
      eventType: "local_vs_ai_mismatch",
      invoiceId,
      message: `Lokale Extraktion weicht von der KI ab: ${mismatches.map((m) => m.field).join(", ")}.`,
      metadata: { mismatches },
    });
  }

  const vendorId = (await resolveAiVendorId(extraction, organizationId)) ?? current.vendorId;
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
    currency,
  });

  if (status !== "ready") {
    const decision = await evaluateAutoApproval(extraction, {
      organizationId,
      vendorId,
      vendorName: extraction.vendor,
      amountGross,
      invoiceDate,
    });
    if (decision.autoApproved) {
      status = "ready";
      await recordSyncEvent({
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

  await sql`
    UPDATE invoices
    SET vendor_id = ${vendorId},
        status = ${status},
        invoice_number = ${invoiceNumber},
        invoice_date = ${invoiceDate},
        service_period_start = ${extraction.service_period_start || current.servicePeriodStart},
        service_period_end = ${extraction.service_period_end || current.servicePeriodEnd},
        amount_gross = ${amountGross},
        amount_net = ${amountNet},
        vat_amount = ${vatAmount},
        currency = ${currency},
        confidence = ${Number(confidence.toFixed(2))},
        doc_type = ${docType},
        updated_at = CURRENT_TIMESTAMP
    WHERE id = ${invoiceId}
  `;
}

async function resolveAiVendorId(
  extraction: InvoiceAiExtraction,
  organizationId: string | null,
): Promise<number | null> {
  const canonicalKey = normalizeCanonicalKey(extraction.normalized_vendor);
  if (canonicalKey) {
    // canonical_key ist global eindeutig → höchstens EIN Treffer. Org-scopen,
    // damit kein org-fremder Vendor zugeordnet wird (Cross-Tenant-Schutz).
    const rows = await sql<{ id: number }[]>`
      SELECT id FROM vendors
      WHERE canonical_key = ${canonicalKey}
        AND (${organizationId}::text IS NULL OR organization_id IS NULL OR organization_id = ${organizationId})
    `;
    if (rows[0]) return rows[0].id;
  }

  const match = await matchVendor([extraction.normalized_vendor || "", extraction.vendor || ""], organizationId);
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

/**
 * Vergleicht die lokal geparsten Felder mit der KI-Extraktion und liefert die
 * materiellen Abweichungen (Betrag > 1 % bzw. > 0,01 absolut, Datum/Währung
 * verschieden). Nur Felder, die BEIDE Seiten gefüllt haben, zählen — fehlt es
 * lokal, ist das kein "Mismatch", sondern eine reine KI-Ergänzung.
 */
function collectLocalVsAiMismatches(
  local: { invoiceDate: string | null; amountGross: number | null; currency: string | null },
  ai: InvoiceAiExtraction,
): Array<{ field: string; local: string | number | null; ai: string | number | null }> {
  const out: Array<{ field: string; local: string | number | null; ai: string | number | null }> = [];
  if (
    local.amountGross != null &&
    ai.amount_gross != null &&
    Math.abs(local.amountGross - ai.amount_gross) > Math.max(0.01, Math.abs(ai.amount_gross) * 0.01)
  ) {
    out.push({ field: "amount_gross", local: local.amountGross, ai: ai.amount_gross });
  }
  if (local.invoiceDate && ai.invoice_date && local.invoiceDate !== ai.invoice_date) {
    out.push({ field: "invoice_date", local: local.invoiceDate, ai: ai.invoice_date });
  }
  if (local.currency && ai.currency && local.currency.toUpperCase() !== ai.currency.toUpperCase()) {
    out.push({ field: "currency", local: local.currency, ai: ai.currency });
  }
  return out;
}

export function resolveInvoiceStatusFromAi(
  extraction: InvoiceAiExtraction,
  input: { vendorId: number | null; invoiceDate: string | null; amountGross: number | null; currency: string | null },
) {
  const isInvoiceLike = ["invoice", "receipt", "payment_confirmation", "credit_note"].includes(extraction.document_type);
  if (!isInvoiceLike) return "ignored";
  if (extraction.needs_review || extraction.confidence < 0.75) return "needs_review";
  if (!input.vendorId || !input.invoiceDate || input.amountGross === null) return "needs_review";
  // Auch nach der KI: Unplausibles (fehlende Währung / Zukunfts-Datum / absurder
  // Betrag) nie ungeprüft freigeben — die KI kann ebenso danebenliegen.
  if (
    !isExtractionPlausible({
      amountGross: input.amountGross,
      currency: input.currency,
      invoiceDate: input.invoiceDate,
    })
  ) {
    return "needs_review";
  }
  return "ready";
}
