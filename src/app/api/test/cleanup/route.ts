import { type NextRequest, NextResponse } from "next/server";
import { unsafeGlobalSql as sql } from "@/lib/db/unsafe-global";
import { getCurrentAuth } from "@/lib/auth/current";

/**
 * POST /api/test/cleanup
 * Löscht Test-Rechnungen des aktuellen Test-Users aus der Datenbank.
 * Nur aktiv wenn ENABLE_TEST_LOGIN=true und nicht in production.
 *
 * Optionaler Body: { "prefix": "test:import:..." } — löscht nur Einträge mit diesem dedupe_key-Präfix.
 * Ohne Body: löscht alle Rechnungen der aktuellen Organisation.
 */
export async function POST(req: NextRequest) {
  if (process.env.ENABLE_TEST_LOGIN !== "true" || process.env.NODE_ENV === "production") {
    return NextResponse.json({ error: "Not enabled" }, { status: 403 });
  }

  const auth = await getCurrentAuth();
  if (!auth?.organization?.id) {
    return NextResponse.json({ error: "Unauthenticated" }, { status: 401 });
  }

  const orgId = auth.organization.id;
  let prefix: string | null = null;

  try {
    const body = await req.json().catch(() => ({}));
    prefix = typeof body.prefix === "string" ? body.prefix : null;
  } catch {
    // Body optional
  }

  let deleted = 0;

  if (prefix) {
    const rows = await sql<{ id: number }[]>`
      SELECT id FROM invoices
      WHERE organization_id = ${orgId}
        AND dedupe_key LIKE ${prefix + "%"}
    `;
    const ids = rows.map((r) => r.id);
    if (ids.length > 0) {
      await sql`DELETE FROM exports WHERE invoice_id = ANY(${ids}::int[])`;
      await sql`DELETE FROM invoice_files WHERE invoice_id = ANY(${ids}::int[])`;
      await sql`DELETE FROM invoices WHERE id = ANY(${ids}::int[])`;
      deleted = ids.length;
    }
  } else {
    const rows = await sql<{ id: number }[]>`
      SELECT id FROM invoices WHERE organization_id = ${orgId}
    `;
    const ids = rows.map((r) => r.id);
    if (ids.length > 0) {
      await sql`DELETE FROM exports WHERE invoice_id = ANY(${ids}::int[])`;
      await sql`DELETE FROM invoice_files WHERE invoice_id = ANY(${ids}::int[])`;
      await sql`DELETE FROM invoices WHERE id = ANY(${ids}::int[])`;
      deleted = ids.length;
    }
  }

  return NextResponse.json({ ok: true, deleted });
}
