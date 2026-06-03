import { unsafeGlobalSql as sql } from "@/lib/db/unsafe-global";
import { BUCKETS, downloadFromStorage } from "@/lib/supabase/storage";
import { runInvoiceAiExtraction, type InvoiceAiProvider } from "@/ai/extract-invoice";
import { parseInvoiceFields } from "@/invoices/parser";
import { matchVendor } from "@/vendors/matcher";

/**
 * Heilt Belege, deren KI-Extraktion VOR dem Schema-Fix (INFETCH-238) mit Zod
 * `too_small` auf den Betragsfeldern scheiterte — Gutschriften/Rückerstattungen
 * mit negativem amount_gross/amount_net/vat_amount. Diese liegen als
 * `needs_review` ohne Betrag/Vendor, mit einer `failed`-ai_extraction
 * (`output_json = null`) — die `reeval-queue` überspringt sie deshalb.
 *
 * Die einzige Heilung ist eine FRISCHE Extraktion: der korrekte (negative)
 * Betrag wurde nie gespeichert, nur die Zod-Fehlermeldung. Wir laden den
 * Roh-Text neu und rufen `runInvoiceAiExtraction` erneut auf — mit dem Fix
 * parst Mistrals Antwort jetzt und `applyAiExtractionToInvoice` persistiert
 * Betrag + doc_type.
 *
 * Idempotent: sobald ein Beleg eine `succeeded`-Extraktion hat, schließt ihn
 * die Query (`NOT EXISTS succeeded`) beim nächsten Lauf aus.
 *
 * SICHERHEIT: `dryRun` ist DEFAULT true — ohne explizites `dryRun: false`
 * wird WEDER Mistral aufgerufen NOCH geschrieben. Schützt vor versehentlichen
 * Prod-Writes/Kosten.
 */

export type ReprocessOutcome =
  | "would_reprocess" // dry-run: Kandidat, noch nichts getan
  | "healed" // frische Extraktion erfolgreich → Betrag persistiert
  | "still_failed" // Extraktion lief, scheiterte aber erneut (anderer Grund)
  | "skipped_no_text" // kein raw_text_path → nicht automatisch heilbar
  | "error"; // unerwarteter Fehler bei diesem Beleg

export type ReprocessDetail = {
  invoiceId: number;
  outcome: ReprocessOutcome;
  amountGross?: number | null;
  note?: string;
};

export type ReprocessResult = {
  dryRun: boolean;
  scanned: number;
  healed: number;
  stillFailed: number;
  skippedNoText: number;
  errors: number;
  details: ReprocessDetail[];
};

export type ReprocessOptions = {
  /** DEFAULT true. Bei true: nur Kandidaten zählen, KEIN Mistral-Call/Write. */
  dryRun?: boolean;
  /** Optionales Limit auf die Anzahl verarbeiteter Belege. */
  limit?: number;
  /** Test-Injection: Mistral-Provider (sonst echter Proxy/Mistral-Pfad). */
  provider?: InvoiceAiProvider;
  /** Test-Injection: Roh-Text-Loader (sonst Storage RAW_TEXT). */
  loadPdfText?: (rawTextPath: string) => Promise<string>;
};

type CandidateRow = {
  id: number;
  organizationId: string | null;
  rawTextPath: string | null;
  originalFilename: string | null;
};

async function defaultLoadPdfText(rawTextPath: string): Promise<string> {
  const buffer = await downloadFromStorage(BUCKETS.RAW_TEXT, rawTextPath);
  return buffer.toString("utf-8");
}

export async function reprocessNegativeAmountFailures(
  options: ReprocessOptions = {},
): Promise<ReprocessResult> {
  const dryRun = options.dryRun ?? true;
  const loadPdfText = options.loadPdfText ?? defaultLoadPdfText;

  // Betroffene Belege: needs_review + eine `failed`-Extraktion mit too_small auf
  // einem Betragsfeld, aber noch KEINE succeeded-Extraktion. Die doppelte
  // Feld-Bedingung grenzt gegen unrelated too_small (z. B. currency length) ab.
  const rows = await sql<CandidateRow[]>`
    SELECT
      i.id,
      i.organization_id AS "organizationId",
      i.raw_text_path AS "rawTextPath",
      (SELECT original_filename FROM invoice_files WHERE invoice_id = i.id ORDER BY id ASC LIMIT 1) AS "originalFilename"
    FROM invoices i
    WHERE i.status = 'needs_review'
      AND EXISTS (
        SELECT 1 FROM ai_extractions ae
        WHERE ae.invoice_id = i.id
          AND ae.status = 'failed'
          AND ae.error ILIKE '%too_small%'
          AND (ae.error ILIKE '%amount_gross%' OR ae.error ILIKE '%amount_net%' OR ae.error ILIKE '%vat_amount%')
      )
      AND NOT EXISTS (
        SELECT 1 FROM ai_extractions ae2 WHERE ae2.invoice_id = i.id AND ae2.status = 'succeeded'
      )
    ORDER BY i.id
    ${options.limit != null ? sql`LIMIT ${options.limit}` : sql``}
  `;

  const result: ReprocessResult = {
    dryRun,
    scanned: rows.length,
    healed: 0,
    stillFailed: 0,
    skippedNoText: 0,
    errors: 0,
    details: [],
  };

  for (const row of rows) {
    if (!row.rawTextPath) {
      result.skippedNoText++;
      result.details.push({
        invoiceId: row.id,
        outcome: "skipped_no_text",
        note: "kein raw_text_path — nicht automatisch heilbar (manuell prüfen)",
      });
      continue;
    }

    if (dryRun) {
      result.details.push({ invoiceId: row.id, outcome: "would_reprocess" });
      continue;
    }

    try {
      const pdfText = await loadPdfText(row.rawTextPath);
      const parsed = parseInvoiceFields(pdfText, row.originalFilename ?? "");
      const vendor = await matchVendor([row.originalFilename ?? "", pdfText], row.organizationId);
      const run = await runInvoiceAiExtraction(
        {
          invoiceId: row.id,
          organizationId: row.organizationId,
          originalFilename: row.originalFilename ?? "reprocess.pdf",
          pdfText,
          localParsed: {
            invoiceNumber: parsed.invoiceNumber,
            invoiceDate: parsed.invoiceDate,
            amountGross: parsed.amountGross,
            currency: parsed.currency,
          },
          localVendorKey: vendor.canonicalKey,
        },
        options.provider,
      );

      if (run.status === "succeeded" || run.status === "cached") {
        result.healed++;
        result.details.push({
          invoiceId: row.id,
          outcome: "healed",
          amountGross: run.extraction.amount_gross,
        });
      } else {
        result.stillFailed++;
        result.details.push({
          invoiceId: row.id,
          outcome: "still_failed",
          note: run.status === "failed" ? run.error : run.reason,
        });
      }
    } catch (err) {
      result.errors++;
      result.details.push({
        invoiceId: row.id,
        outcome: "error",
        note: err instanceof Error ? err.message : String(err),
      });
    }
  }

  return result;
}
