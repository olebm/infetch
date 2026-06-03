/**
 * POST /api/cron/monthly-report
 *
 * Monatlicher Report: Verschickt eine Zusammenfassung des Vormonats an alle Org-Owner.
 * Cron-Schedule: 0 8 1 * *  (1. jeden Monats um 08:00 Uhr)
 *
 * Absicherung: CRON_SECRET muss als Bearer-Token im Authorization-Header mitgegeben werden.
 *
 * Die Kernlogik liegt in src/lib/automation/monthly-report.ts und wird auch direkt
 * vom auto-pilot.ts Cron-Scheduler aufgerufen.
 */

import crypto from "node:crypto";
import { NextResponse } from "next/server";
import { runMonthlyReport } from "@/lib/automation/monthly-report";

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
    const expHash = crypto.createHash("sha256").update(expected).digest();
    if (!crypto.timingSafeEqual(authHash, expHash)) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
  }

  // Optional: Monat aus Body überschreiben (für manuelle Test-Trigger)
  let overrideMonth: string | undefined;
  try {
    const body = (await req.json().catch(() => ({}))) as { month?: string };
    if (body?.month && /^\d{4}-\d{2}$/.test(body.month)) {
      overrideMonth = body.month;
    }
  } catch {
    // kein Body → Vormonat verwenden
  }

  const result = await runMonthlyReport(overrideMonth);

  if (result.skipped) {
    return NextResponse.json({ skipped: true, reason: result.skipped });
  }

  return NextResponse.json({ ok: true, ...result });
}
