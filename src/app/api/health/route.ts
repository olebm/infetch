/**
 * GET /api/health
 *
 * Liveness-Probe für Coolify/Traefik. Bewusst dependency-frei (keine DB,
 * keine externen Calls): antwortet, solange der Node-Prozess läuft. Ein
 * DB-Ping hier wäre gefährlich — ein transienter DB-Blip würde den Container
 * sonst aus dem Routing kicken und einen echten Outage erzeugen.
 *
 * Öffentlich (in APP_PUBLIC_PREFIXES, src/proxy.ts) — sonst 307 → /login.
 */

import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export function GET(): NextResponse {
  return NextResponse.json({ ok: true }, { status: 200 });
}
