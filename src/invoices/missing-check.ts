import { format, subMonths } from "date-fns";
import { unsafeGlobalSql as sql } from "@/lib/db/unsafe-global";
import { appConfig } from "@/lib/config/env";
import { recordSyncEvent } from "@/lib/db/events";
import { resolveVendorMonthStatus, type SourceStatus } from "@/invoices/status";
import { getOrgTier, getScanSinceDate } from "@/lib/tier";

type VendorRow = {
  id: number;
  name: string;
  portalEnabled: boolean;
  organizationId: string | null;
};

type InvoiceSignal = {
  id: number;
  organizationId: string | null;
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

export async function runMissingInvoiceCheck(): Promise<MissingCheckResult> {
  const syncRunRows = await sql<{ id: number }[]>`
    INSERT INTO sync_runs (type, status, triggered_by, started_at)
    VALUES ('missing_check', 'running', 'user', CURRENT_TIMESTAMP)
    RETURNING id
  `;
  const syncRunId = Number(syncRunRows[0].id);

  try {
    // vendor_month_status ist seit Migration 0019 org-scoped → pro Org prüfen.
    const orgs = await sql<{ id: string; createdAt: string | null }[]>`
      SELECT id, created_at::text AS "createdAt" FROM organizations WHERE deleted_at IS NULL ORDER BY created_at
    `;
    // organization_id mitladen: pro Org nur die für sie relevanten Vendors
    // prüfen (eigene + globale Seeds). Ohne diesen Filter bekäme jede Org
    // "missing"-Rows für die privaten Vendors ALLER anderen Orgs.
    const vendors = await sql<VendorRow[]>`
      SELECT id, name, portal_enabled AS "portalEnabled",
             organization_id AS "organizationId"
      FROM vendors
      ORDER BY name
    `;
    const months = getSyncMonths();
    const invoiceByOrgVendorMonth = await getInvoiceSignals();
    const summary = { checked: 0, found: 0, required: 0, actionRequired: 0, disabled: 0 };

    for (const org of orgs) {
      // Fenster pro Org auf das TATSÄCHLICHE Import-Fenster begrenzen
      // (getScanSinceDate — exakt das, was der Scanner abruft) und nicht vor
      // Org-Beginn. Sonst entstehen "missing"-Zellen für Monate, die nie
      // gescannt wurden (Free = nur laufender Monat) → falsche „Fehlt"-Flut.
      const tier = await getOrgTier(org.id);
      const sinceMonth = format(getScanSinceDate(tier, appConfig.syncMonthsBack), "yyyy-MM");
      const orgStartMonth = org.createdAt ? org.createdAt.slice(0, 7) : sinceMonth;
      const lowerBound = sinceMonth > orgStartMonth ? sinceMonth : orgStartMonth;
      const orgMonths = months.filter((m) => m >= lowerBound);

      // Veraltete Zellen außerhalb des Fensters wegräumen (rein abgeleiteter
      // Cache, wird in-Fenster neu erzeugt) — hält „Fehlt" konsistent.
      await sql`
        DELETE FROM vendor_month_status
        WHERE organization_id = ${org.id} AND year_month < ${lowerBound}
      `;

      // Nur eigene + globale Seed-Vendors dieser Org.
      const orgVendors = vendors.filter(
        (v) => v.organizationId === null || v.organizationId === org.id,
      );
      for (const vendor of orgVendors) {
        for (const yearMonth of orgMonths) {
          const signal = invoiceByOrgVendorMonth.get(`${org.id}:${vendor.id}:${yearMonth}`);
          const sourceStatus = await resolveSourceStatus(vendor, yearMonth, signal, org.id);
          const final = resolveVendorMonthStatus(sourceStatus);
          await upsertVendorMonthStatus({
            organizationId: org.id,
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
    }

    await sql`
      UPDATE sync_runs
      SET status = 'succeeded', finished_at = CURRENT_TIMESTAMP, summary_json = ${JSON.stringify(summary)}
      WHERE id = ${syncRunId}
    `;
    await recordSyncEvent({
      level: "info",
      eventType: "missing_check_completed",
      message: "Missing Check abgeschlossen.",
      metadata: { ...summary, syncRunId },
    });

    return { syncRunId, ...summary };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Missing check failed";
    await sql`
      UPDATE sync_runs
      SET status = 'failed', finished_at = CURRENT_TIMESTAMP, summary_json = ${JSON.stringify({ error: message })}
      WHERE id = ${syncRunId}
    `;
    await recordSyncEvent({
      level: "error",
      eventType: "missing_check_failed",
      message: "Missing Check fehlgeschlagen.",
      metadata: { syncRunId, error: message },
    });
    throw error;
  }
}

async function getInvoiceSignals() {
  const rows = await sql<InvoiceSignal[]>`
    SELECT id, organization_id AS "organizationId", vendor_id AS "vendorId",
           source, SUBSTR(invoice_date, 1, 7) AS "yearMonth"
    FROM invoices
    WHERE vendor_id IS NOT NULL
      AND invoice_date IS NOT NULL
      AND status NOT IN ('ignored', 'duplicate', 'failed')
    ORDER BY
      CASE source WHEN 'manual' THEN 1 WHEN 'mail' THEN 2 ELSE 3 END,
      created_at DESC
  `;

  const map = new Map<string, InvoiceSignal>();
  for (const row of rows) {
    const key = `${row.organizationId}:${row.vendorId}:${row.yearMonth}`;
    if (!map.has(key)) map.set(key, row);
  }
  return map;
}

async function resolveSourceStatus(
  vendor: VendorRow,
  yearMonth: string,
  signal: InvoiceSignal | undefined,
  organizationId: string | null,
): Promise<SourceStatus> {
  if (signal?.source === "manual") {
    return { manualStatus: "imported", mailStatus: "unchecked", portalStatus: "not_needed" };
  }
  if (signal?.source === "mail") {
    return { manualStatus: "none", mailStatus: "found", portalStatus: "not_needed" };
  }
  if (signal?.source === "portal") {
    return { manualStatus: "none", mailStatus: "missing", portalStatus: "found" };
  }

  const existing = await sql<{ portalStatus: SourceStatus["portalStatus"] }[]>`
    SELECT portal_status AS "portalStatus"
    FROM vendor_month_status
    WHERE vendor_id = ${vendor.id} AND year_month = ${yearMonth}
      AND organization_id IS NOT DISTINCT FROM ${organizationId}
  `;

  if (!vendor.portalEnabled) {
    return { manualStatus: "none", mailStatus: "missing", portalStatus: "disabled" };
  }
  const existingStatus = existing[0]?.portalStatus;
  if (
    existingStatus === "running" ||
    existingStatus === "failed" ||
    existingStatus === "not_found"
  ) {
    return { manualStatus: "none", mailStatus: "missing", portalStatus: existingStatus };
  }
  return { manualStatus: "none", mailStatus: "missing", portalStatus: "required" };
}

async function upsertVendorMonthStatus(input: {
  organizationId: string | null;
  vendorId: number;
  yearMonth: string;
  sourceStatus: SourceStatus;
  finalStatus: "unchecked" | "found" | "missing" | "action_required";
  sourceUsed: "none" | "manual" | "mail" | "portal";
  invoiceId: number | null;
}): Promise<void> {
  await sql`
    INSERT INTO vendor_month_status (
      organization_id, vendor_id, year_month, mail_status, portal_status, manual_status,
      final_status, source_used, invoice_id, last_checked_at
    )
    VALUES (
      ${input.organizationId}, ${input.vendorId}, ${input.yearMonth},
      ${input.sourceStatus.mailStatus}, ${input.sourceStatus.portalStatus}, ${input.sourceStatus.manualStatus},
      ${input.finalStatus}, ${input.sourceUsed}, ${input.invoiceId}, CURRENT_TIMESTAMP
    )
    ON CONFLICT(organization_id, vendor_id, year_month) DO UPDATE SET
      mail_status = excluded.mail_status,
      portal_status = excluded.portal_status,
      manual_status = excluded.manual_status,
      final_status = excluded.final_status,
      source_used = excluded.source_used,
      invoice_id = excluded.invoice_id,
      last_checked_at = CURRENT_TIMESTAMP
  `;
}
