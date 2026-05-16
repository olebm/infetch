/**
 * POST /api/csp-report
 *
 * Sammelt CSP-Verstöße während der Report-Only-Phase. Der Browser sendet
 * diese Reports ohne Auth/Cookies — der Endpoint ist daher öffentlich,
 * begrenzt aber die Body-Größe und antwortet immer mit 204.
 */

import { NextResponse, type NextRequest } from "next/server";

export const runtime = "nodejs";

const MAX_BODY_BYTES = 16 * 1024;

export async function POST(request: NextRequest): Promise<NextResponse> {
  try {
    const raw = await request.text();
    if (raw.length <= MAX_BODY_BYTES) {
      let report: unknown = raw;
      try {
        report = JSON.parse(raw);
      } catch {
        /* Body kein JSON — Rohtext loggen */
      }
      console.warn("[csp-report]", JSON.stringify(report));
    }
  } catch {
    /* defekter Report — ignorieren, nie den Browser stören */
  }
  return new NextResponse(null, { status: 204 });
}
