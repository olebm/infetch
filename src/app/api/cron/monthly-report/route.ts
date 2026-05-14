/**
 * POST /api/cron/monthly-report
 *
 * Monatlicher Report: Verschickt eine Zusammenfassung des Vormonats an alle Org-Owner.
 * Cron-Schedule: 0 8 1 * *  (1. jeden Monats um 08:00 Uhr)
 *
 * Absicherung: CRON_SECRET muss als Bearer-Token im Authorization-Header mitgegeben werden.
 */

import crypto from "node:crypto";
import { NextResponse } from "next/server";
import { sql } from "@/lib/db/client";
import { sendMonthlyReport } from "@/lib/mail/notify";
import { appConfig } from "@/lib/config/env";

export const runtime = "nodejs";

export async function POST(req: Request): Promise<NextResponse> {
  // ── Auth ─────────────────────────────────────────────────────────────────────
  // SECURITY (INFETCH-89/93): In Production MUSS CRON_SECRET gesetzt sein.
  // Vergleich via Hash-basiertem timingSafeEqual — verhindert Timing-Angriffe.
  const cronSecret = process.env.CRON_SECRET?.trim();
  if (!cronSecret) {
    if ((process.env.NODE_ENV as string) === "production") {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
  } else {
    const auth = req.headers.get("authorization") ?? "";
    const expected = `Bearer ${cronSecret}`;
    const authHash = crypto.createHash("sha256").update(auth).digest();
    const expHash  = crypto.createHash("sha256").update(expected).digest();
    if (!crypto.timingSafeEqual(authHash, expHash)) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
  }

  if (!appConfig.resendOutbound.apiKey) {
    return NextResponse.json({ skipped: true, reason: "no RESEND_API_KEY" });
  }

  // Vormonat berechnen (wir laufen am 1. des aktuellen Monats)
  const now = new Date();
  const prevMonthDate = new Date(now.getFullYear(), now.getMonth() - 1, 1);
  const prevMonth = prevMonthDate.toISOString().slice(0, 7); // "YYYY-MM"

  // Vorvormonat für Delta-Vergleich
  const prevPrevDate = new Date(now.getFullYear(), now.getMonth() - 2, 1);
  const prevPrevMonth = prevPrevDate.toISOString().slice(0, 7);

  // Alle Org-Owner holen
  const owners = await sql<{ email: string; orgId: string }[]>`
    SELECT u.email, o.id AS "orgId"
    FROM users u
    INNER JOIN organizations o ON o.owner_user_id = u.id
  `;

  const results: { email: string; sent: boolean }[] = [];

  const prevMonthPrefix = prevMonth + "%";
  const prevPrevMonthPrefix = prevPrevMonth + "%";

  for (const { email, orgId } of owners) {
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

    // Top-3-Anbieter des Vormonats
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
      topVendors: topVendors.map((v) => ({ ...v, count: Number(v.count), sumGross: Number(v.sumGross) })),
    });

    results.push({ email, sent: ok });
  }

  return NextResponse.json({ ok: true, month: prevMonth, results });
}
