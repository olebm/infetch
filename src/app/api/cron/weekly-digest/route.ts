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
import { getDb } from "@/lib/db/client";
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

  const db = getDb();

  // Hole alle Org-Owner-E-Mails
  const owners = db
    .prepare(
      `SELECT u.email, o.id AS orgId
       FROM users u
       INNER JOIN organizations o ON o.owner_user_id = u.id`,
    )
    .all() as { email: string; orgId: string }[];

  const oneWeekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000)
    .toISOString()
    .slice(0, 19);

  const results: { email: string; sent: boolean }[] = [];

  for (const { email, orgId } of owners) {
    const { sent, reviewed, pending } = db
      .prepare(
        `SELECT
           COUNT(CASE WHEN status = 'exported' AND updated_at >= ? THEN 1 END) AS sent,
           COUNT(CASE WHEN status IN ('ready','exported') AND updated_at >= ? AND source != 'auto' THEN 1 END) AS reviewed,
           COUNT(CASE WHEN status = 'needs_review' THEN 1 END) AS pending
         FROM invoices
         WHERE organization_id = ? OR organization_id IS NULL`,
      )
      .get(oneWeekAgo, oneWeekAgo, orgId) as {
        sent: number;
        reviewed: number;
        pending: number;
      };

    const ok = await sendWeeklyDigest({ to: email, sent, reviewed, pending });
    results.push({ email, sent: ok });
  }

  return NextResponse.json({ ok: true, results });
}
