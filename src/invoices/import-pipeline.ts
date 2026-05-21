import crypto from "node:crypto";
import type postgres from "postgres";
import { unsafeGlobalSql as sql } from "@/lib/db/unsafe-global";
import { recordSyncEvent } from "@/lib/db/events";
import { BUCKETS, uploadToStorage, deleteFromStorage, buildInvoiceStorageKey } from "@/lib/supabase/storage";
import { runInvoiceAiExtraction } from "@/ai/extract-invoice";
import { attemptAutoTransfer } from "@/lib/automation/auto-transfer";
import { sendReviewNotification } from "@/lib/mail/notify";
import { syncStoredInvoiceFileNamesForInvoice } from "@/invoices/file-names";
import { extractPdfText } from "@/invoices/local-extractor";
import { classifyFilenameAsJunk } from "@/invoices/filename-junk-filter";
import { parseInvoiceFields } from "@/invoices/parser";
import { describeImplausibility } from "@/invoices/plausibility";
import { isLikelyPdf, maxPdfSizeBytes } from "@/invoices/pdf-validation";
import { deriveInvoiceProductLabel } from "@/invoices/product-label";
import { matchVendor } from "@/vendors/matcher";
import { canImportInvoice, canStoreFile, getOrgTier, TIER_LIMITS } from "@/lib/tier";
import { sendUpgradeNudge } from "@/lib/mail/notify";
import { readJsonSetting, writeJsonSetting } from "@/lib/db/settings-store";
import { isLocalExtractionSufficient } from "@/invoices/extraction-sufficiency";
export { isLocalExtractionSufficient };

export type ImportInvoiceResult =
  | { ok: true; status: "imported"; invoiceId: number; fileId: number; message: string }
  | { ok: true; status: "duplicate"; invoiceId: number | null; fileId: number; message: string }
  | { ok: false; status: "failed"; message: string }
  | { ok: false; status: "quota_exceeded"; message: string; current: number; max: number };

/**
 * Thrown by the in-transaction quota recheck (TOCTOU prevention).
 * Caught by the outer try/catch and converted to a `quota_exceeded`
 * result instead of being re-thrown.
 */
class QuotaExceededError extends Error {
  constructor(
    public readonly kind: "invoices" | "storage",
    public readonly current: number,
    public readonly max: number,
  ) {
    super(`Quota exceeded (${kind}): ${current}/${max}`);
    this.name = "QuotaExceededError";
  }
}

type ImportPdfSource = "manual" | "mail" | "portal";

type ImportPdfBufferInput = {
  buffer: Buffer;
  originalFilename: string;
  mimeType?: string | null;
  sourceType: ImportPdfSource;
  sourceRefId?: string | null;
  /** Organisations-ID für Tier-Quota-Check. Wenn null → keine Quota-Prüfung (legacy). */
  organizationId?: string | null;
  /** Quota-Prüfung überspringen (z. B. für retroaktiven 12-Monats-Scan). */
  bypassQuota?: boolean;
};

type ExistingFileRow = {
  id: number;
  invoiceId: number | null;
  originalFilename: string;
};

// ─── Upgrade-Nudge (fire & forget, max. 1× pro 7 Tage pro Org) ───────────────

async function fireUpgradeNudgeIfNeeded(
  orgId: string,
  current: number,
  max: number,
): Promise<void> {
  try {
    const settingKey = `upgrade_nudge_sent_${orgId}`;
    const lastSent = await readJsonSetting<string | null>(settingKey, null);
    if (lastSent) {
      const daysSince = (Date.now() - new Date(lastSent).getTime()) / (1000 * 60 * 60 * 24);
      if (daysSince < 7) return; // nicht spammen
    }
    const ownerRows = await sql<{ email: string; name: string | null }[]>`
      SELECT u.email, u.name
      FROM users u
      INNER JOIN organizations o ON o.owner_user_id = u.id
      WHERE o.id = ${orgId}
      LIMIT 1
    `;
    const owner = ownerRows[0];
    if (!owner) return;
    const sent = await sendUpgradeNudge({ to: owner.email, current, max });
    if (sent) await writeJsonSetting(settingKey, new Date().toISOString());
  } catch (err) {
    console.error("[upgrade-nudge]", err);
  }
}

export async function importManualPdf(input: {
  file: File;
  organizationId?: string | null;
}): Promise<ImportInvoiceResult> {
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
    organizationId: input.organizationId,
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

  // ── Tier-Quota-Check ────────────────────────────────────────────────────────
  if (input.organizationId !== undefined && !input.bypassQuota) {
    const orgId = input.organizationId;

    const [invoiceQuota, storageQuota] = await Promise.all([
      canImportInvoice(orgId),
      canStoreFile(orgId, input.buffer.byteLength),
    ]);

    if (!invoiceQuota.allowed) {
      if (orgId) void fireUpgradeNudgeIfNeeded(orgId, invoiceQuota.current, invoiceQuota.max);
      return {
        ok: false,
        status: "quota_exceeded",
        message: `Monatslimit erreicht: ${invoiceQuota.current} von ${invoiceQuota.max} Rechnungen importiert. Bitte auf Pro upgraden.`,
        current: invoiceQuota.current,
        max: invoiceQuota.max,
      };
    }

    if (!storageQuota.allowed) {
      const usedMb  = Math.round(storageQuota.usedBytes  / (1024 * 1024));
      const maxMb   = Math.round(storageQuota.maxBytes   / (1024 * 1024));
      if (orgId) void fireUpgradeNudgeIfNeeded(orgId, storageQuota.usedBytes, storageQuota.maxBytes);
      return {
        ok: false,
        status: "quota_exceeded",
        message: `Speicherlimit erreicht: ${usedMb} MB von ${maxMb} MB belegt. Bitte auf Pro upgraden.`,
        current: storageQuota.usedBytes,
        max: storageQuota.maxBytes,
      };
    }
  }
  // ────────────────────────────────────────────────────────────────────────────

  const sha256 = crypto.createHash("sha256").update(buffer).digest("hex");
  // Dedup ist pro Org — dasselbe PDF in zwei Orgs ist KEINE Dublette
  // (Migration 0019: UNIQUE(organization_id, sha256)).
  const existingRows = await sql<ExistingFileRow[]>`
    SELECT id, invoice_id AS "invoiceId", original_filename AS "originalFilename"
    FROM invoice_files
    WHERE sha256 = ${sha256}
      AND organization_id IS NOT DISTINCT FROM ${input.organizationId ?? null}
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
  // Plausibilitäts-Check: nur zuverlässig erfasste Rechnungen dürfen ungeprüft
  // freigegeben werden. Fehlende Währung, Zukunfts-Datum oder ein absurder
  // Betrag (z. B. gieriger Regex → 350.167.000,00 €) → manuelle Prüfung statt
  // Auto-Export. Den Grund halten wir im Import-Event fest (auditierbar).
  const implausibilityReason = describeImplausibility({
    amountGross: parsed.amountGross,
    currency: parsed.currency,
    invoiceDate: parsed.invoiceDate,
  });
  const status = junkCheck.isJunk
    ? "ignored"
    : vendor.vendorId && parsed.invoiceDate && parsed.amountGross && implausibilityReason === null
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
    orgId: input.organizationId ?? null,
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

  // Wrap core DB inserts in a transaction so a mid-flight failure does not
  // leave orphaned invoice rows without a corresponding invoice_file row.
  // Storage uploads already happened — on rollback we clean them up below.
  let invoiceId: number;
  let fileId: number;
  try {
    const ids = await sql.begin(async (tx) => {
      // ── TOCTOU prevention ─────────────────────────────────────────────────
      // The outer pre-check (canImportInvoice/canStoreFile above) is a
      // fail-fast: skip PDF extraction + AI for clearly over-limit orgs.
      // It runs OUTSIDE this transaction, so two concurrent imports for the
      // same org would both pass it and over-shoot the quota by 1+.
      //
      // Inside the transaction we (a) lock the organizations row with
      // FOR UPDATE to serialize concurrent imports for the same org and
      // (b) re-count via `tx` so the COUNT sees the row that a concurrent
      // T1 just inserted (after T1 commits and releases the lock). Different
      // orgs hold different row locks and never block each other.
      if (input.organizationId && !input.bypassQuota) {
        const orgId = input.organizationId;
        await tx`SELECT 1 FROM organizations WHERE id = ${orgId} FOR UPDATE`;

        const tier = await getOrgTier(orgId);
        const limits = TIER_LIMITS[tier];

        if (Number.isFinite(limits.maxInvoicesPerMonth)) {
          const invoiceCountRows = await tx<{ count: string }[]>`
            SELECT COUNT(*)::text AS count
            FROM invoices
            WHERE organization_id = ${orgId}
              AND created_at >= TO_CHAR(DATE_TRUNC('month', NOW()), 'YYYY-MM-DD')
          `;
          const current = Number(invoiceCountRows[0]?.count ?? 0);
          if (current >= limits.maxInvoicesPerMonth) {
            throw new QuotaExceededError("invoices", current, limits.maxInvoicesPerMonth);
          }
        }

        const storageRows = await tx<{ bytes: string }[]>`
          SELECT COALESCE(SUM(f.size_bytes), 0)::text AS bytes
          FROM invoice_files f
          INNER JOIN invoices i ON i.id = f.invoice_id
          WHERE i.organization_id = ${orgId}
        `;
        const usedBytes = Number(storageRows[0]?.bytes ?? 0);
        if (usedBytes + buffer.byteLength > limits.maxStorageBytes) {
          throw new QuotaExceededError("storage", usedBytes, limits.maxStorageBytes);
        }
      }
      // ──────────────────────────────────────────────────────────────────────

      const invoiceRows = await tx<{ id: number }[]>`
        INSERT INTO invoices (
          organization_id, vendor_id, source, status, invoice_number, invoice_date,
          amount_gross, currency, confidence, dedupe_key, raw_text_path
        )
        VALUES (
          ${input.organizationId ?? null}, ${vendor.vendorId}, ${input.sourceType}, ${status},
          ${parsed.invoiceNumber}, ${parsed.invoiceDate}, ${parsed.amountGross},
          ${parsed.currency}, ${confidence}, ${sha256}, ${rawTextPath}
        )
        RETURNING id
      `;
      const newInvoiceId = Number(invoiceRows[0].id);

      const fileRows = await tx<{ id: number }[]>`
        INSERT INTO invoice_files (
          invoice_id, organization_id, original_filename, stored_path, sha256,
          size_bytes, mime_type, source_type, source_ref_id
        )
        VALUES (
          ${newInvoiceId}, ${input.organizationId ?? null}, ${input.originalFilename},
          ${storedPath}, ${sha256}, ${buffer.byteLength},
          ${input.mimeType || "application/pdf"},
          ${input.sourceType}, ${input.sourceRefId || null}
        )
        RETURNING id
      `;
      const newFileId = Number(fileRows[0].id);

      await upsertVendorMonthStatusTx(tx, {
        organizationId: input.organizationId ?? null,
        vendorId: vendor.vendorId,
        invoiceId: newInvoiceId,
        invoiceDate: parsed.invoiceDate,
        sourceType: input.sourceType,
      });

      return { invoiceId: newInvoiceId, fileId: newFileId };
    });
    invoiceId = ids.invoiceId;
    fileId = ids.fileId;
  } catch (err) {
    // Transaction rolled back — remove orphaned storage files
    await Promise.allSettled([
      deleteFromStorage(BUCKETS.INVOICES, storageKey),
      deleteFromStorage(BUCKETS.RAW_TEXT, rawTextKey),
    ]);
    // TOCTOU recheck fired: convert to a normal quota_exceeded result
    // instead of an exception bubbling up to the caller.
    if (err instanceof QuotaExceededError) {
      if (input.organizationId) {
        void fireUpgradeNudgeIfNeeded(input.organizationId, err.current, err.max);
      }
      if (err.kind === "invoices") {
        return {
          ok: false,
          status: "quota_exceeded",
          message: `Monatslimit erreicht: ${err.current} von ${err.max} Rechnungen importiert. Bitte auf Pro upgraden.`,
          current: err.current,
          max: err.max,
        };
      }
      const usedMb = Math.round(err.current / (1024 * 1024));
      const maxMb = Math.round(err.max / (1024 * 1024));
      return {
        ok: false,
        status: "quota_exceeded",
        message: `Speicherlimit erreicht: ${usedMb} MB von ${maxMb} MB belegt. Bitte auf Pro upgraden.`,
        current: err.current,
        max: err.max,
      };
    }
    throw err;
  }

  await recordSyncEvent({
    level: extraction.error ? "warning" : "info",
    eventType: `${input.sourceType}_pdf_imported`,
    vendorId: vendor.vendorId,
    invoiceId,
    yearMonth: parsed.invoiceDate?.slice(0, 7),
    message: `${input.originalFilename} wurde importiert.`,
    metadata: { sha256, extractionError: extraction.error, storedPath, implausibilityReason },
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
  } else if (extraction.text.trim().length < 20) {
    // Kein (brauchbarer) Text extrahierbar — passwortgeschütztes oder
    // reines Bild-PDF. Ein KI-Call mit leerem Text liefert keinen
    // Mehrwert, kostet aber. Direkt zur manuellen Prüfung.
    await recordSyncEvent({
      level: "warning",
      eventType: "skipped_no_text",
      invoiceId,
      message:
        "Kein Text aus PDF extrahierbar (passwortgeschützt/Bild-PDF) — KI-Analyse übersprungen.",
      metadata: { extractionError: extraction.error ?? null },
    });
    aiStatus = "skipped_no_text";
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
      organizationId: input.organizationId ?? null,
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
  await attemptAutoTransfer(invoiceId, input.organizationId);

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
      sendReviewNotification({
        to: ownerRow.email,
        vendorName: vendor.canonicalKey ?? input.originalFilename,
        invoiceId,
      }).catch((err) => console.error("[review-notification]", err));
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
  parsed: { invoiceDate: string | null; amountGross: number | null; invoiceNumber: string | null; currency: string | null },
  text: string,
  extractionError: string | null,
) {
  let score = vendorConfidence;
  if (parsed.invoiceDate) score += 0.03;
  if (parsed.amountGross) score += 0.03;
  if (parsed.invoiceNumber) score += 0.02;
  if (parsed.currency) score += 0.02;
  if (text.length > 50) score += 0.02;
  if (extractionError) score -= 0.2;
  // Unplausible Extraktion (fehlende Währung / Zukunfts-Datum / absurder Betrag)
  // → Konfidenz hart dämpfen. Senkt overallConfidence unter die Sufficiency-
  // Schwelle, sodass die KI greift, statt Müll lokal als "fertig" zu werten.
  if (
    describeImplausibility({
      amountGross: parsed.amountGross,
      currency: parsed.currency,
      invoiceDate: parsed.invoiceDate,
    }) !== null
  ) {
    score -= 0.3;
  }
  return Math.max(0, Math.min(0.98, Number(score.toFixed(2))));
}

async function upsertVendorMonthStatusTx(
  tx: postgres.TransactionSql,
  input: {
    organizationId: string | null;
    vendorId: number | null;
    invoiceId: number;
    invoiceDate: string | null;
    sourceType: ImportPdfSource;
  },
): Promise<void> {
  if (!input.vendorId || !input.invoiceDate) return;
  const yearMonth = input.invoiceDate.slice(0, 7);
  const statusBySource = {
    manual: { mailStatus: "unchecked", portalStatus: "not_needed", manualStatus: "imported", sourceUsed: "manual" },
    mail: { mailStatus: "found", portalStatus: "not_needed", manualStatus: "none", sourceUsed: "mail" },
    portal: { mailStatus: "missing", portalStatus: "found", manualStatus: "none", sourceUsed: "portal" },
  }[input.sourceType];

  await tx`
    INSERT INTO vendor_month_status (
      organization_id, vendor_id, year_month, mail_status, portal_status, manual_status,
      final_status, source_used, invoice_id, last_checked_at
    )
    VALUES (
      ${input.organizationId}, ${input.vendorId}, ${yearMonth},
      ${statusBySource.mailStatus}, ${statusBySource.portalStatus}, ${statusBySource.manualStatus},
      'found', ${statusBySource.sourceUsed}, ${input.invoiceId}, CURRENT_TIMESTAMP
    )
    ON CONFLICT(organization_id, vendor_id, year_month) DO UPDATE SET
      mail_status = excluded.mail_status,
      portal_status = excluded.portal_status,
      manual_status = excluded.manual_status,
      final_status = 'found',
      source_used = excluded.source_used,
      invoice_id = excluded.invoice_id,
      last_checked_at = CURRENT_TIMESTAMP
  `;
}
