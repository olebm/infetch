/**
 * POST /api/cron/weekly-digest
 *
 * Wöchentlicher Digest: Verschickt eine Zusammenfassung an alle Org-Owner.
 * Cron-Schedule: 0 8 * * 1  (Montags um 08:00 Uhr)
 *
 * Absicherung: CRON_SECRET muss als Bearer-Token im Authorization-Header mitgegeben werden.
 *
 * Die Kernlogik liegt in src/lib/automation/weekly-digest.ts und wird auch direkt
 * vom auto-pilot.ts Cron-Scheduler aufgerufen.
 */

import crypto from "node:crypto";
import { NextResponse } from "next/server";
import { runWeeklyDigest } from "@/lib/automation/weekly-digest";

export const runtime = "nodejs";

export async function POST(req: Request): Promise<NextResponse> {
  // ── Auth ─────────────────────────────────────────────────────────────────────
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

  const result = await runWeeklyDigest();

  if (result.skipped) {
    return NextResponse.json({ skipped: true, reason: result.skipped });
  }

  return NextResponse.json({ ok: true, ...result });
}
