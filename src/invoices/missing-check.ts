import { format, subMonths } from "date-fns";
import type Database from "better-sqlite3";
import { appConfig } from "@/lib/config/env";
import { getDb } from "@/lib/db/client";
import { recordSyncEvent } from "@/lib/db/events";
import { resolveVendorMonthStatus, type SourceStatus } from "@/invoices/status";

type VendorRow = {
  id: number;
  name: string;
  portalEnabled: number;
};

type InvoiceSignal = {
  id: number;
  vendorId: number;
  source: "manual" | "mail" | "portal";
  yearMonth: string;
};

export type MissingCheckResult = {
  syncRunId: number;
  checked: number;
  found: number;
  required: number;
  actionRequired: number;
  disabled: number;
};

export function getSyncMonths() {
  return Array.from({ length: appConfig.syncMonthsBack }, (_, index) =>
    format(subMonths(new Date(), appConfig.syncMonthsBack - index - 1), "yyyy-MM"),
  );
}

export function runMissingInvoiceCheck(db: Database.Database = getDb()): MissingCheckResult {
  const syncRun = db
    .prepare(
      `INSERT INTO sync_runs (type, status, triggered_by, started_at)
       VALUES ('missing_check', 'running', 'user', CURRENT_TIMESTAMP)`,
    )
    .run();
  const syncRunId = Number(syncRun.lastInsertRowid);

  try {
    const vendors = db
      .prepare(
        `SELECT id, name, portal_enabled AS portalEnabled
         FROM vendors
         ORDER BY name COLLATE NOCASE`,
      )
      .all() as VendorRow[];
    const months = getSyncMonths();
    const invoiceByVendorMonth = getInvoiceSignals(db);
    const summary = { checked: 0, found: 0, required: 0, actionRequired: 0, disabled: 0 };

    const tx = db.transaction(() => {
      for (const vendor of vendors) {
        for (const yearMonth of months) {
          const signal = invoiceByVendorMonth.get(`${vendor.id}:${yearMonth}`);
          const sourceStatus = resolveSourceStatus(db, vendor, yearMonth, signal);
          const final = resolveVendorMonthStatus(sourceStatus);
          upsertVendorMonthStatus(db, {
            vendorId: vendor.id,
            yearMonth,
            sourceStatus,
            finalStatus: final.finalStatus,
            sourceUsed: final.sourceUsed,
            invoiceId: signal?.id ?? null,
          });

          summary.checked += 1;
          if (final.finalStatus === "found") summary.found += 1;
          if (sourceStatus.portalStatus === "required") summary.required += 1;
          if (final.finalStatus === "action_required") summary.actionRequired += 1;
          if (sourceStatus.portalStatus === "disabled") summary.disabled += 1;
        }
      }
    });

    tx();

    db.prepare(
      `UPDATE sync_runs
       SET status = 'succeeded', finished_at = CURRENT_TIMESTAMP, summary_json = ?
       WHERE id = ?`,
    ).run(JSON.stringify(summary), syncRunId);
    recordSyncEvent(db, {
      level: "info",
      eventType: "missing_check_completed",
      message: "Missing Check abgeschlossen.",
      metadata: { ...summary, syncRunId },
    });

    return { syncRunId, ...summary };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Missing check failed";
    db.prepare(
      `UPDATE sync_runs
       SET status = 'failed', finished_at = CURRENT_TIMESTAMP, summary_json = ?
       WHERE id = ?`,
    ).run(JSON.stringify({ error: message }), syncRunId);
    recordSyncEvent(db, {
      level: "error",
      eventType: "missing_check_failed",
      message: "Missing Check fehlgeschlagen.",
      metadata: { syncRunId, error: message },
    });
    throw error;
  }
}

function getInvoiceSignals(db: Database.Database) {
  const rows = db
    .prepare(
      `SELECT id, vendor_id AS vendorId, source, substr(invoice_date, 1, 7) AS yearMonth
       FROM invoices
       WHERE vendor_id IS NOT NULL
         AND invoice_date IS NOT NULL
         AND status NOT IN ('ignored', 'duplicate', 'failed')
       ORDER BY
         CASE source WHEN 'manual' THEN 1 WHEN 'mail' THEN 2 ELSE 3 END,
         created_at DESC`,
    )
    .all() as InvoiceSignal[];

  const map = new Map<string, InvoiceSignal>();
  for (const row of rows) {
    const key = `${row.vendorId}:${row.yearMonth}`;
    if (!map.has(key)) map.set(key, row);
  }
  return map;
}

function resolveSourceStatus(
  db: Database.Database,
  vendor: VendorRow,
  yearMonth: string,
  signal: InvoiceSignal | undefined,
): SourceStatus {
  if (signal?.source === "manual") {
    return { manualStatus: "imported", mailStatus: "unchecked", portalStatus: "not_needed" };
  }
  if (signal?.source === "mail") {
    return { manualStatus: "none", mailStatus: "found", portalStatus: "not_needed" };
  }
  if (signal?.source === "portal") {
    return { manualStatus: "none", mailStatus: "missing", portalStatus: "found" };
  }

  const existing = db
    .prepare(
      `SELECT portal_status AS portalStatus
       FROM vendor_month_status
       WHERE vendor_id = ? AND year_month = ?`,
    )
    .get(vendor.id, yearMonth) as { portalStatus: SourceStatus["portalStatus"] } | undefined;

  if (!vendor.portalEnabled) {
    return { manualStatus: "none", mailStatus: "missing", portalStatus: "disabled" };
  }
  if (existing?.portalStatus === "running" || existing?.portalStatus === "failed" || existing?.portalStatus === "not_found") {
    return { manualStatus: "none", mailStatus: "missing", portalStatus: existing.portalStatus };
  }
  return { manualStatus: "none", mailStatus: "missing", portalStatus: "required" };
}

function upsertVendorMonthStatus(
  db: Database.Database,
  input: {
    vendorId: number;
    yearMonth: string;
    sourceStatus: SourceStatus;
    finalStatus: "unchecked" | "found" | "missing" | "action_required";
    sourceUsed: "none" | "manual" | "mail" | "portal";
    invoiceId: number | null;
  },
) {
  db.prepare(
    `INSERT INTO vendor_month_status (
      vendor_id, year_month, mail_status, portal_status, manual_status, final_status,
      source_used, invoice_id, last_checked_at
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
    ON CONFLICT(vendor_id, year_month) DO UPDATE SET
      mail_status = excluded.mail_status,
      portal_status = excluded.portal_status,
      manual_status = excluded.manual_status,
      final_status = excluded.final_status,
      source_used = excluded.source_used,
      invoice_id = excluded.invoice_id,
      last_checked_at = CURRENT_TIMESTAMP`,
  ).run(
    input.vendorId,
    input.yearMonth,
    input.sourceStatus.mailStatus,
    input.sourceStatus.portalStatus,
    input.sourceStatus.manualStatus,
    input.finalStatus,
    input.sourceUsed,
    input.invoiceId,
  );
}
