/**
 * POST /api/cron/retention
 *
 * Löscht abgelaufene Mail-Scan-Metadaten (Datensparsamkeit).
 * Cron-Schedule-Empfehlung: 0 3 * * *  (täglich um 03:00 Uhr)
 *
 * Absicherung: CRON_SECRET als Bearer-Token im Authorization-Header.
 */

import crypto from "node:crypto";
import { NextResponse } from "next/server";
import { runRetention } from "@/lib/automation/retention";

export const runtime = "nodejs";

export async function POST(req: Request): Promise<NextResponse> {
  const cronSecret = process.env.CRON_SECRET?.trim();
  if (!cronSecret) {
    // Ohne CRON_SECRET nur in lokaler Entwicklung offen. Staging/Preview/
    // Test (oft mit echten Daten) erfordern den Secret — sonst 401.
    if ((process.env.NODE_ENV as string) !== "development") {
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

  const result = await runRetention();
  return NextResponse.json({ ok: true, ...result });
}
