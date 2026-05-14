/**
 * POST /api/cron/weekly-digest
 *
 * Wöchentlicher Digest: Verschickt eine Zusammenfassung an alle Org-Owner.
 * Aufgerufen von einem externen Cron (Coolify Scheduler, GitHub Actions o.ä.)
 * oder manuell via curl.
 *
 * Absicherung: CRON_SECRET muss als Bearer-Token im Authorization-Header mitgegeben werden.
 */

import crypto from "node:crypto";
import { NextResponse } from "next/server";
import { sql } from "@/lib/db/client";
import { sendWeeklyDigest } from "@/lib/mail/notify";
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

  // Hole alle Org-Owner-E-Mails
  const owners = await sql<{ email: string; orgId: string }[]>`
    SELECT u.email, o.id AS "orgId"
    FROM users u
    INNER JOIN organizations o ON o.owner_user_id = u.id
  `;

  const oneWeekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000)
    .toISOString()
    .slice(0, 19);

  const results: { email: string; sent: boolean }[] = [];

  for (const { email, orgId } of owners) {
    const statsRows = await sql<{ sent: string; reviewed: string; pending: string }[]>`
      SELECT
        COUNT(CASE WHEN status = 'exported' AND updated_at >= ${oneWeekAgo}::timestamp THEN 1 END)::text AS sent,
        COUNT(CASE WHEN status IN ('ready','exported') AND updated_at >= ${oneWeekAgo}::timestamp AND source != 'auto' THEN 1 END)::text AS reviewed,
        COUNT(CASE WHEN status = 'needs_review' THEN 1 END)::text AS pending
      FROM invoices
      WHERE organization_id = ${orgId} OR organization_id IS NULL
    `;
    const stats = statsRows[0] ?? { sent: "0", reviewed: "0", pending: "0" };

    const ok = await sendWeeklyDigest({
      to: email,
      sent: Number(stats.sent),
      reviewed: Number(stats.reviewed),
      pending: Number(stats.pending),
    });
    results.push({ email, sent: ok });
  }

  return NextResponse.json({ ok: true, results });
}
