import { NextRequest, NextResponse } from "next/server";
import { sql } from "@/lib/db/client";
import { getCurrentAuth } from "@/lib/auth/current";
import { downloadFromStorage, BUCKETS } from "@/lib/supabase/storage";

export const dynamic = "force-dynamic";

export async function GET(_request: NextRequest, context: { params: Promise<{ fileId: string }> }) {
  // SECURITY (INFETCH-86): Auth-Check + Org-Scoping.
  // Route war aus der Middleware ausgenommen (für iframe-Nutzung), hat aber keinen eigenen Check.
  const auth = await getCurrentAuth();
  if (!auth) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const { fileId } = await context.params;
  const id = Number(fileId);
  if (!Number.isInteger(id) || id <= 0) {
    return NextResponse.json({ error: "invalid file id" }, { status: 400 });
  }

  const orgId = auth.organization?.id ?? null;

  // Org-Scoping: Nur Dateien die zur eigenen Organisation gehören
  const rows = await sql<{ storedPath: string; originalFilename: string }[]>`
    SELECT f.stored_path AS "storedPath", f.original_filename AS "originalFilename"
    FROM invoice_files f
    INNER JOIN invoices i ON i.id = f.invoice_id
    WHERE f.id = ${id}
      AND (i.organization_id = ${orgId} OR i.organization_id IS NULL)
    LIMIT 1
  `;
  const row = rows[0];

  if (!row) {
    return NextResponse.json({ error: "file not found" }, { status: 404 });
  }

  try {
    const buffer = await downloadFromStorage(BUCKETS.INVOICES, row.storedPath);
    return new NextResponse(new Uint8Array(buffer), {
      headers: {
        "content-type": "application/pdf",
        "content-length": String(buffer.byteLength),
        "content-disposition": `inline; filename="${encodeURIComponent(row.originalFilename)}"`,
      },
    });
  } catch {
    return NextResponse.json({ error: "file unreadable" }, { status: 500 });
  }
}
