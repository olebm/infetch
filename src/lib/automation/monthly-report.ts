/**
 * Monatlicher Report — Kernlogik.
 *
 * Ruft KPIs + Top-Anbieter für alle Org-Owner des Vormonats ab
 * und verschickt jeweils eine Zusammenfassungs-E-Mail via Resend.
 *
 * Wird aufgerufen von:
 *   - auto-pilot.ts  (Cron: 0 8 1 * *)
 *   - /api/cron/monthly-report  (HTTP-Trigger für externe Scheduler)
 */

import { sql } from "@/lib/db/client";
import { sendMonthlyReport } from "@/lib/mail/notify";
import { appConfig } from "@/lib/config/env";

export type MonthlyReportResult = {
  month: string;
  results: Array<{ email: string; sent: boolean; error?: string }>;
  skipped?: string;
};

export async function runMonthlyReport(
  overrideMonth?: string,
): Promise<MonthlyReportResult> {
  if (!appConfig.brevo.apiKey) {
    return { month: "", results: [], skipped: "no BREVO_API_KEY" };
  }

  // Vormonat berechnen (Standard: wir laufen am 1. des aktuellen Monats)
  const now = new Date();
  let prevMonth: string;
  let prevPrevMonth: string;

  if (overrideMonth) {
    prevMonth = overrideMonth;
    const [y, m] = overrideMonth.split("-").map(Number);
    const prevPrevDate = new Date((y ?? 0), (m ?? 1) - 2, 1);
    prevPrevMonth = prevPrevDate.toISOString().slice(0, 7);
  } else {
    const prevMonthDate = new Date(now.getFullYear(), now.getMonth() - 1, 1);
    prevMonth = prevMonthDate.toISOString().slice(0, 7);
    const prevPrevDate = new Date(now.getFullYear(), now.getMonth() - 2, 1);
    prevPrevMonth = prevPrevDate.toISOString().slice(0, 7);
  }

  // Alle Org-Owner holen
  const owners = await sql<{ email: string; orgId: string }[]>`
    SELECT u.email, o.id AS "orgId"
    FROM users u
    INNER JOIN organizations o ON o.owner_user_id = u.id
  `;

  const results: Array<{ email: string; sent: boolean; error?: string }> = [];
  const prevMonthPrefix = prevMonth + "%";
  const prevPrevMonthPrefix = prevPrevMonth + "%";

  for (const { email, orgId } of owners) {
    try {
      // KPIs für den Vormonat
      const kpiRows = await sql<{
        sent: number;
        sentManual: number;
        sumGross: number;
        prevSent: number;
        prevSumGross: number;
      }[]>`
        SELECT
          COUNT(CASE WHEN invoice_date LIKE ${prevMonthPrefix} THEN 1 END)::int AS sent,
          COUNT(CASE WHEN invoice_date LIKE ${prevMonthPrefix} AND COALESCE(source, 'auto') != 'auto' THEN 1 END)::int AS "sentManual",
          COALESCE(SUM(CASE WHEN invoice_date LIKE ${prevMonthPrefix} THEN COALESCE(amount_gross, 0) ELSE 0 END), 0) AS "sumGross",
          COUNT(CASE WHEN invoice_date LIKE ${prevPrevMonthPrefix} THEN 1 END)::int AS "prevSent",
          COALESCE(SUM(CASE WHEN invoice_date LIKE ${prevPrevMonthPrefix} THEN COALESCE(amount_gross, 0) ELSE 0 END), 0) AS "prevSumGross"
        FROM invoices
        WHERE status = 'exported'
          AND (organization_id = ${orgId} OR organization_id IS NULL)
      `;
      const kpis = kpiRows[0] ?? { sent: 0, sentManual: 0, sumGross: 0, prevSent: 0, prevSumGross: 0 };

      const pendingRows = await sql<{ count: string }[]>`
        SELECT COUNT(*)::text AS count FROM invoices
        WHERE status = 'needs_review'
          AND (organization_id = ${orgId} OR organization_id IS NULL)
      `;
      const pending = Number(pendingRows[0]?.count ?? 0);

      const topVendors = await sql<{ name: string; count: number; sumGross: number }[]>`
        SELECT
          v.name,
          COUNT(*)::int AS count,
          COALESCE(SUM(COALESCE(i.amount_gross, 0)), 0) AS "sumGross"
        FROM invoices i
        JOIN vendors v ON v.id = i.vendor_id
        WHERE i.status = 'exported'
          AND i.invoice_date LIKE ${prevMonthPrefix}
          AND (i.organization_id = ${orgId} OR i.organization_id IS NULL)
        GROUP BY v.id, v.name
        ORDER BY count DESC
        LIMIT 3
      `;

      const sent = kpis.sent ?? 0;

      // Nichts zu berichten → Mail überspringen
      if (sent === 0 && pending === 0) {
        results.push({ email, sent: false });
        continue;
      }

      const ok = await sendMonthlyReport({
        to: email,
        month: prevMonth,
        sent,
        sentAuto: sent - (kpis.sentManual ?? 0),
        sentManual: kpis.sentManual ?? 0,
        sumGross: Number(kpis.sumGross ?? 0),
        prevSent: kpis.prevSent ?? 0,
        prevSumGross: Number(kpis.prevSumGross ?? 0),
        pending,
        topVendors: topVendors.map((v) => ({
          ...v,
          count: Number(v.count),
          sumGross: Number(v.sumGross),
        })),
      });

      results.push({ email, sent: ok });
    } catch (err) {
      // Org-Fehler isolieren: einen kaputten Owner-Datensatz nicht den
      // gesamten Cron-Lauf für die übrigen Orgs abwürgen lassen.
      const message = err instanceof Error ? err.message : String(err);
      console.error(
        `[monthly-report] org ${orgId} (${email}) failed:`,
        message,
      );
      results.push({ email, sent: false, error: message });
    }
  }

  return { month: prevMonth, results };
}
