import type Database from "better-sqlite3";
import { evaluateAutoApproval } from "@/lib/automation/auto-approval";
import { recordSyncEvent } from "@/lib/db/events";
import type { InvoiceAiExtraction } from "@/ai/schemas";

const INVOICE_TYPES = new Set(["invoice", "receipt", "payment_confirmation", "credit_note"]);

export type ReevalResult = {
  scanned: number;
  ignored: number;
  approved: number;
  unchanged: number;
};

type Row = {
  id: number;
  vendor_id: number | null;
  vendor_name: string | null;
  invoice_date: string | null;
  amount_gross: number | null;
  output_json: string | null;
};

/**
 * Geht alle 'needs_review' Rechnungen durch und wendet die aktuelle Logik
 * erneut an. Heilt Bestand der entstand bevor Fixes da waren oder wenn neue
 * Auto-Approval-Rules angelegt wurden.
 *
 * Idempotent — Rechnungen ohne Änderungsbedarf bleiben unangetastet.
 */
export function reevaluateReviewQueue(db: Database.Database): ReevalResult {
  const rows = db
    .prepare(
      `SELECT i.id, i.vendor_id, v.name AS vendor_name, i.invoice_date, i.amount_gross, ae.output_json
       FROM invoices i
       LEFT JOIN vendors v ON v.id = i.vendor_id
       LEFT JOIN ai_extractions ae ON ae.invoice_id = i.id AND ae.status = 'succeeded'
       WHERE i.status = 'needs_review'`,
    )
    .all() as Row[];

  const result: ReevalResult = { scanned: rows.length, ignored: 0, approved: 0, unchanged: 0 };

  const updateIgnored = db.prepare(
    `UPDATE invoices SET status = 'ignored', updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
  );
  const updateReady = db.prepare(
    `UPDATE invoices SET status = 'ready', updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
  );

  for (const row of rows) {
    if (!row.output_json) {
      result.unchanged++;
      continue;
    }

    let extraction: InvoiceAiExtraction;
    try {
      extraction = JSON.parse(row.output_json) as InvoiceAiExtraction;
    } catch {
      result.unchanged++;
      continue;
    }

    // Phase 1: Non-Rechnungen → 'ignored'
    if (!INVOICE_TYPES.has(extraction.document_type)) {
      updateIgnored.run(row.id);
      result.ignored++;
      recordSyncEvent(db, {
        level: "info",
        eventType: "reeval_marked_ignored",
        invoiceId: row.id,
        message: `Reevaluiert als '${extraction.document_type}' — auf 'ignored' verschoben.`,
        metadata: { reason: extraction.review_reason || null },
      });
      continue;
    }

    // Phase 2: Echte Rechnung → Auto-Approval erneut versuchen
    const decision = evaluateAutoApproval(db, extraction, {
      vendorId: row.vendor_id,
      vendorName: row.vendor_name,
      amountGross: row.amount_gross,
      invoiceDate: row.invoice_date,
    });

    if (decision.autoApproved) {
      updateReady.run(row.id);
      result.approved++;
      recordSyncEvent(db, {
        level: "info",
        eventType: "reeval_auto_approved",
        invoiceId: row.id,
        message: `Reevaluiert und auto-approved (via ${decision.via}).`,
        metadata: { via: decision.via, ruleId: decision.ruleId },
      });
    } else {
      result.unchanged++;
    }
  }

  return result;
}
