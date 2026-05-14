import { NextResponse } from "next/server";
import { getCurrentAuth } from "@/lib/auth/current";
import { canRetroactiveScan } from "@/lib/tier";
import { runPrimaryImapScan } from "@/mail/mail-scanner";
import { subMonths } from "date-fns";

/**
 * POST /api/scan/backfill
 *
 * Löst einen retroaktiven IMAP-Scan für die Organisation des eingeloggten Nutzers aus.
 * Scannt die letzten 12 Monate. Imports werden NICHT gegen das Monatslimit gezählt.
 * Nur für Pro-/Business-Nutzer verfügbar.
 */
export async function POST() {
  const auth = await getCurrentAuth();
  if (!auth?.user || !auth?.organization) {
    return NextResponse.json({ error: "Nicht eingeloggt." }, { status: 401 });
  }

  const orgId = auth.organization.id;

  const allowed = await canRetroactiveScan(orgId);
  if (!allowed) {
    return NextResponse.json(
      { error: "Retroaktiver Scan ist nur im Pro-Plan verfügbar." },
      { status: 403 },
    );
  }

  try {
    const since = subMonths(new Date(), 12);
    const result = await runPrimaryImapScan({
      sinceOverride: since,
      bypassQuota: true,
      limitToOrgId: orgId,
    });

    return NextResponse.json({
      ok: true,
      message: `Retroaktiver Scan abgeschlossen: ${result.imported} neue Rechnung(en) importiert.`,
      result,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Scan fehlgeschlagen.";
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
