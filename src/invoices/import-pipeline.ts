import crypto from "node:crypto";
import { sql } from "@/lib/db/client";
import { recordSyncEvent } from "@/lib/db/events";
import { BUCKETS, uploadToStorage, buildInvoiceStorageKey } from "@/lib/supabase/storage";
import { runInvoiceAiExtraction } from "@/ai/extract-invoice";
import { attemptAutoTransfer } from "@/lib/automation/auto-transfer";
import { sendReviewNotification } from "@/lib/mail/notify";
import { syncStoredInvoiceFileNamesForInvoice } from "@/invoices/file-names";
import { extractPdfText } from "@/invoices/local-extractor";
import { classifyFilenameAsJunk } from "@/invoices/filename-junk-filter";
import { parseInvoiceFields } from "@/invoices/parser";
import { isLikelyPdf, maxPdfSizeBytes } from "@/invoices/pdf-validation";
import { deriveInvoiceProductLabel } from "@/invoices/product-label";
import { matchVendor } from "@/vendors/matcher";

export type ImportInvoiceResult =
  | { ok: true; status: "imported"; invoiceId: number; fileId: number; message: string }
  | { ok: true; status: "duplicate"; invoiceId: number | null; fileId: number; message: string }
  | { ok: false; status: "failed"; message: string };

type ImportPdfSource = "manual" | "mail" | "portal";

type ImportPdfBufferInput = {
  buffer: Buffer;
  originalFilename: string;
  mimeType?: string | null;
  sourceType: ImportPdfSource;
  sourceRefId?: string | null;
};

type ExistingFileRow = {
  id: number;
  invoiceId: number | null;
  originalFilename: string;
};

export async function importManualPdf(input: { file: File }): Promise<ImportInvoiceResult> {
  if (!input.file || input.file.size === 0) {
    return { ok: false, status: "failed", message: "Keine PDF-Datei ausgewählt." };
  }

  if (!input.file.name.toLowerCase().endsWith(".pdf")) {
    return { ok: false, status: "failed", message: "Nur PDF-Dateien können importiert werden." };
  }

  if (input.file.size > maxPdfSizeBytes) {
    return { ok: false, status: "failed", message: "PDF ist größer als 20 MB und wurde nicht importiert." };
  }

  return importPdfBuffer({
    buffer: Buffer.from(await input.file.arrayBuffer()),
    originalFilename: input.file.name,
    mimeType: input.file.type || "application/pdf",
    sourceType: "manual",
    sourceRefId: null,
  });
}

export async function importPdfBuffer(input: ImportPdfBufferInput): Promise<ImportInvoiceResult> {
  if (!input.buffer.byteLength) {
    return { ok: false, status: "failed", message: "PDF ist leer und wurde nicht importiert." };
  }

  if (!input.originalFilename.toLowerCase().endsWith(".pdf")) {
    return { ok: false, status: "failed", message: "Nur PDF-Dateien können importiert werden." };
  }

  if (input.buffer.byteLength > maxPdfSizeBytes) {
    return { ok: false, status: "failed", message: "PDF ist größer als 20 MB und wurde nicht importiert." };
  }

  const buffer = input.buffer;
  if (!isLikelyPdf(buffer)) {
    return { ok: false, status: "failed", message: "Datei hat keinen gültigen PDF-Header und wurde nicht importiert." };
  }

  const sha256 = crypto.createHash("sha256").update(buffer).digest("hex");
  const existingRows = await sql<ExistingFileRow[]>`
    SELECT id, invoice_id AS "invoiceId", original_filename AS "originalFilename"
    FROM invoice_files
    WHERE sha256 = ${sha256}
  `;
  const existing = existingRows[0];

  if (existing) {
    await recordSyncEvent({
      level: "warning",
      eventType: `${input.sourceType}_import_duplicate`,
      invoiceId: existing.invoiceId,
      message: `PDF wurde bereits importiert: ${existing.originalFilename}`,
      metadata: { sha256, duplicateFileId: existing.id, sourceType: input.sourceType },
    });

    return {
      ok: true,
      status: "duplicate",
      invoiceId: existing.invoiceId,
      fileId: existing.id,
      message: "Dublette erkannt. Die PDF wurde bereits importiert.",
    };
  }

  // Pre-Filter: Filename signalisiert eindeutig Non-Invoice — kein AI-Call nötig.
  const junkCheck = classifyFilenameAsJunk(input.originalFilename);

  const extraction = await extractPdfText(buffer);
  const parsed = parseInvoiceFields(extraction.text, input.originalFilename);
  const vendor = await matchVendor([input.originalFilename, extraction.text]);
  const status = junkCheck.isJunk
    ? "ignored"
    : vendor.vendorId && parsed.invoiceDate && parsed.amountGross
      ? "ready"
      : "needs_review";
  const confidence = calculateConfidence(vendor.confidence, parsed, extraction.text, extraction.error);
  const productLabel = deriveInvoiceProductLabel({
    vendorKey: vendor.canonicalKey,
    originalFilename: input.originalFilename,
    text: extraction.text,
  });

  // Determine Storage keys and upload to Supabase Storage
  const storageKey = buildInvoiceStorageKey({
    orgId: null, // TODO Phase 2.5: pass real orgId through
    vendorKey: vendor.canonicalKey,
    productLabel,
    invoiceDate: parsed.invoiceDate,
    fallbackDate: new Date().toISOString().slice(0, 10),
  });
  const rawTextKey = `${sha256}.txt`;
  await uploadToStorage(BUCKETS.INVOICES, storageKey, buffer, { contentType: "application/pdf" });
  await uploadToStorage(BUCKETS.RAW_TEXT, rawTextKey, extraction.text, { contentType: "text/plain; charset=utf-8" });
  const storedPath = storageKey;   // DB column now stores Storage key
  const rawTextPath = rawTextKey;  // DB column now stores Storage key

  // Insert invoice
  const invoiceRows = await sql<{ id: number }[]>`
    INSERT INTO invoices (
      vendor_id, source, status, invoice_number, invoice_date, amount_gross, currency,
      confidence, dedupe_key, raw_text_path
    )
    VALUES (
      ${vendor.vendorId}, ${input.sourceType}, ${status},
      ${parsed.invoiceNumber}, ${parsed.invoiceDate}, ${parsed.amountGross},
      ${parsed.currency}, ${confidence}, ${sha256}, ${rawTextPath}
    )
    RETURNING id
  `;
  const invoiceId = Number(invoiceRows[0].id);

  // Insert invoice_file
  const fileRows = await sql<{ id: number }[]>`
    INSERT INTO invoice_files (
      invoice_id, original_filename, stored_path, sha256, size_bytes, mime_type, source_type, source_ref_id
    )
    VALUES (
      ${invoiceId}, ${input.originalFilename}, ${storedPath}, ${sha256},
      ${buffer.byteLength}, ${input.mimeType || "application/pdf"},
      ${input.sourceType}, ${input.sourceRefId || null}
    )
    RETURNING id
  `;
  const fileId = Number(fileRows[0].id);

  await upsertVendorMonthStatus({
    vendorId: vendor.vendorId,
    invoiceId,
    invoiceDate: parsed.invoiceDate,
    sourceType: input.sourceType,
  });

  await recordSyncEvent({
    level: extraction.error ? "warning" : "info",
    eventType: `${input.sourceType}_pdf_imported`,
    vendorId: vendor.vendorId,
    invoiceId,
    yearMonth: parsed.invoiceDate?.slice(0, 7),
    message: `${input.originalFilename} wurde importiert.`,
    metadata: { sha256, extractionError: extraction.error, storedPath },
  });

  let aiStatus: string;
  if (junkCheck.isJunk) {
    await recordSyncEvent({
      level: "info",
      eventType: "filename_junk_skipped",
      invoiceId,
      message: `Filename "${input.originalFilename}" als Non-Invoice eingestuft — Mistral-Analyse übersprungen.`,
      metadata: { pattern: junkCheck.matchedPattern },
    });
    aiStatus = "skipped_junk_filename";
  } else if (isLocalExtractionSufficient(vendor.confidence, parsed, extraction, confidence)) {
    await recordSyncEvent({
      level: "info",
      eventType: "local_extraction_sufficient",
      invoiceId,
      message: "Lokale Extraktion vollständig — Mistral-Analyse übersprungen.",
      metadata: {
        vendorConfidence: vendor.confidence,
        localConfidence: confidence,
        invoiceDate: parsed.invoiceDate,
        amountGross: parsed.amountGross,
      },
    });
    aiStatus = "skipped_local";
  } else {
    const aiResult = await runInvoiceAiExtraction({
      invoiceId,
      originalFilename: input.originalFilename,
      pdfText: extraction.text,
      localParsed: {
        invoiceNumber: parsed.invoiceNumber,
        invoiceDate: parsed.invoiceDate,
        amountGross: parsed.amountGross,
        currency: parsed.currency,
      },
      localVendorKey: vendor.canonicalKey,
    });
    aiStatus = aiResult.status;
  }

  await syncStoredInvoiceFileNamesForInvoice(invoiceId);

  // Auto-Transfer: wenn Status='ready' (durch Auto-Approval gesetzt) UND eine
  // Integration aktiv ist, pushe direkt an die Steuersoftware.
  await attemptAutoTransfer(invoiceId);

  const finalStatusRows = await sql<{ status: string }[]>`
    SELECT status FROM invoices WHERE id = ${invoiceId}
  `;
  const finalStatus = finalStatusRows[0]?.status;

  // Benachrichtigung bei manuellem Review-Bedarf
  if (finalStatus === "needs_review") {
    const ownerRows = await sql<{ email: string }[]>`
      SELECT u.email FROM users u
      INNER JOIN org_members om ON om.user_id = u.id
      INNER JOIN organizations o ON o.id = om.organization_id
      WHERE o.owner_user_id = u.id
      LIMIT 1
    `;
    const ownerRow = ownerRows[0];

    if (ownerRow?.email) {
      void sendReviewNotification({
        to: ownerRow.email,
        vendorName: vendor.canonicalKey ?? input.originalFilename,
        invoiceId,
      });
    }
  }

  return {
    ok: true,
    status: "imported",
    invoiceId,
    fileId,
    message: buildImportMessage(finalStatus || status, aiStatus),
  };
}

export function isLocalExtractionSufficient(
  vendorConfidence: number,
  parsed: { invoiceDate: string | null; amountGross: number | null },
  extraction: { error: string | null },
  overallConfidence: number,
): boolean {
  return (
    vendorConfidence >= 0.72 &&
    parsed.invoiceDate !== null &&
    parsed.amountGross !== null &&
    extraction.error === null &&
    overallConfidence >= 0.8
  );
}

function buildImportMessage(invoiceStatus: string, aiStatus: string) {
  const base =
    invoiceStatus === "ready" ? "PDF importiert und als exportbereit markiert." : "PDF importiert. Review ist erforderlich.";
  if (aiStatus === "skipped_local") return `${base} Alle Felder lokal extrahiert — Mistral nicht benötigt.`;
  if (aiStatus === "succeeded" || aiStatus === "cached") return `${base} Mistral Analyse abgeschlossen.`;
  if (aiStatus === "failed") return `${base} Mistral Analyse fehlgeschlagen.`;
  if (aiStatus === "skipped") return `${base} Mistral Analyse übersprungen.`;
  return base;
}

function calculateConfidence(
  vendorConfidence: number,
  parsed: { invoiceDate: string | null; amountGross: number | null; invoiceNumber: string | null },
  text: string,
  extractionError: string | null,
) {
  let score = vendorConfidence;
  if (parsed.invoiceDate) score += 0.03;
  if (parsed.amountGross) score += 0.03;
  if (parsed.invoiceNumber) score += 0.02;
  if (text.length > 50) score += 0.02;
  if (extractionError) score -= 0.2;
  return Math.max(0, Math.min(0.98, Number(score.toFixed(2))));
}

async function upsertVendorMonthStatus(input: {
  vendorId: number | null;
  invoiceId: number;
  invoiceDate: string | null;
  sourceType: ImportPdfSource;
}): Promise<void> {
  if (!input.vendorId || !input.invoiceDate) return;
  const yearMonth = input.invoiceDate.slice(0, 7);
  const statusBySource = {
    manual: { mailStatus: "unchecked", portalStatus: "not_needed", manualStatus: "imported", sourceUsed: "manual" },
    mail: { mailStatus: "found", portalStatus: "not_needed", manualStatus: "none", sourceUsed: "mail" },
    portal: { mailStatus: "missing", portalStatus: "found", manualStatus: "none", sourceUsed: "portal" },
  }[input.sourceType];

  await sql`
    INSERT INTO vendor_month_status (
      vendor_id, year_month, mail_status, portal_status, manual_status, final_status,
      source_used, invoice_id, last_checked_at
    )
    VALUES (
      ${input.vendorId}, ${yearMonth},
      ${statusBySource.mailStatus}, ${statusBySource.portalStatus}, ${statusBySource.manualStatus},
      'found', ${statusBySource.sourceUsed}, ${input.invoiceId}, CURRENT_TIMESTAMP
    )
    ON CONFLICT(vendor_id, year_month) DO UPDATE SET
      mail_status = excluded.mail_status,
      portal_status = excluded.portal_status,
      manual_status = excluded.manual_status,
      final_status = 'found',
      source_used = excluded.source_used,
      invoice_id = excluded.invoice_id,
      last_checked_at = CURRENT_TIMESTAMP
  `;
}
