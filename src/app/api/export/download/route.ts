import { existsSync, readFileSync } from "node:fs";
import { NextRequest } from "next/server";
import JSZip from "jszip";
import { getDb } from "@/lib/db/client";
import { getCurrentAuth } from "@/lib/auth/current";

export const dynamic = "force-dynamic";

// ─── Types ────────────────────────────────────────────────────────────────────

type InvoiceRow = {
  invoiceId: number;
  invoiceDate: string | null;
  createdAt: string;
  invoiceNumber: string | null;
  amountGross: number | null;
  amountNet: number | null;
  vatAmount: number | null;
  currency: string | null;
  status: string;
  vendorName: string | null;
  vendorKey: string | null;
  storedPath: string | null;
  originalFilename: string | null;
};

// ─── CSV builder ─────────────────────────────────────────────────────────────

function csvEscape(v: string | null | undefined): string {
  if (v == null || v === "") return "";
  let s = String(v);
  // SECURITY (INFETCH-92): CSV Formula-Injection verhindern.
  // Führende =, +, -, @ lösen in älteren Excel-Versionen DDE-Ausführung aus.
  if (/^[=+\-@]/.test(s)) s = "'" + s;
  if (s.includes('"') || s.includes(";") || s.includes("\n")) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

function fmtAmount(v: number | null | undefined): string {
  if (v == null) return "";
  return v.toFixed(2).replace(".", ",");
}

function fmtDate(iso: string | null | undefined): string {
  if (!iso) return "";
  const d = new Date(iso.includes("T") ? iso : iso + "T00:00:00Z");
  if (isNaN(d.getTime())) return iso;
  return d.toLocaleDateString("de-DE", { day: "2-digit", month: "2-digit", year: "numeric" });
}

function buildCsv(rows: InvoiceRow[]): string {
  const headers = [
    "Datum",
    "Rechnungsnummer",
    "Anbieter",
    "Betrag netto",
    "Betrag brutto",
    "MwSt",
    "Währung",
    "Status",
    "Dateiname",
  ];

  const statusLabel: Record<string, string> = {
    exported:     "versendet",
    needs_review: "zu prüfen",
    ready:        "bereit",
    new:          "neu",
    ignored:      "ignoriert",
    duplicate:    "Duplikat",
    failed:       "Fehler",
  };

  const lines = [
    headers.join(";"),
    ...rows.map((r) =>
      [
        csvEscape(fmtDate(r.invoiceDate ?? r.createdAt)),
        csvEscape(r.invoiceNumber),
        csvEscape(r.vendorName),
        csvEscape(fmtAmount(r.amountNet)),
        csvEscape(fmtAmount(r.amountGross)),
        csvEscape(fmtAmount(r.vatAmount)),
        csvEscape(r.currency ?? "EUR"),
        csvEscape(statusLabel[r.status] ?? r.status),
        csvEscape(r.originalFilename),
      ].join(";"),
    ),
  ];

  // BOM for Excel compatibility
  return "﻿" + lines.join("\r\n");
}

// ─── Route ────────────────────────────────────────────────────────────────────

export async function GET(request: NextRequest) {
  const auth = await getCurrentAuth();
  if (!auth) {
    return new Response("Nicht angemeldet.", { status: 401 });
  }

  const { searchParams } = new URL(request.url);

  // SECURITY (INFETCH-90): year-Parameter validieren — verhindert Header-Injection
  // via Content-Disposition filename.
  const rawYear = searchParams.get("year") ?? null;
  if (rawYear !== null && !/^\d{4}$/.test(rawYear)) {
    return new Response("Ungültiger year-Parameter.", { status: 400 });
  }
  const year = rawYear;

  const rawVendor = searchParams.get("vendorId") ?? null;
  const vendorId  = rawVendor ? Number(rawVendor) : null;

  const db = getDb();

  // SECURITY (INFETCH-87): Org-Scoping — nur Rechnungen der eigenen Organisation.
  const orgId = auth.organization?.id ?? null;

  const whereClauses: string[] = ["i.status NOT IN ('ignored', 'duplicate')"];
  if (orgId) {
    whereClauses.push("(i.organization_id = ? OR i.organization_id IS NULL)");
  }
  const params: Array<string | number> = orgId ? [orgId] : [];

  if (year) {
    whereClauses.push("strftime('%Y', COALESCE(i.invoice_date, i.created_at)) = ?");
    params.push(year);
  }
  if (vendorId && !isNaN(vendorId)) {
    whereClauses.push("i.vendor_id = ?");
    params.push(vendorId);
  }

  const where = `WHERE ${whereClauses.join(" AND ")}`;

  const rows = db
    .prepare(
      `SELECT
         i.id              AS invoiceId,
         i.invoice_date    AS invoiceDate,
         i.created_at      AS createdAt,
         i.invoice_number  AS invoiceNumber,
         i.amount_gross    AS amountGross,
         i.amount_net      AS amountNet,
         i.vat_amount      AS vatAmount,
         i.currency,
         i.status,
         v.name            AS vendorName,
         v.canonical_key   AS vendorKey,
         f.stored_path     AS storedPath,
         f.original_filename AS originalFilename
       FROM invoices i
       LEFT JOIN vendors v ON v.id = i.vendor_id
       LEFT JOIN invoice_files f ON f.invoice_id = i.id
       ${where}
       ORDER BY COALESCE(i.invoice_date, i.created_at) DESC`,
    )
    .all(...params) as InvoiceRow[];

  if (rows.length === 0) {
    return new Response(
      "Keine Rechnungen für diesen Zeitraum gefunden.",
      { status: 404, headers: { "content-type": "text/plain; charset=utf-8" } },
    );
  }

  // Build ZIP
  const zip = new JSZip();

  // 1. CSV metadata sheet
  zip.file("rechnungen.csv", buildCsv(rows));

  // 2. PDFs — grouped in subfolders by vendor
  let pdfCount = 0;
  for (const row of rows) {
    if (!row.storedPath || !existsSync(row.storedPath)) continue;
    try {
      const buffer = readFileSync(row.storedPath);
      const folder  = row.vendorKey ?? "unbekannt";
      const name    = row.originalFilename ?? `rechnung-${row.invoiceId}.pdf`;
      zip.folder(folder)!.file(name, buffer);
      pdfCount++;
    } catch {
      // skip unreadable file — still include it in CSV
    }
  }

  const zipBuffer = await zip.generateAsync({
    type:        "nodebuffer",
    compression: pdfCount > 0 ? "DEFLATE" : "STORE",
    compressionOptions: { level: 6 },
  });

  // Filename label
  let label = "alle";
  if (vendorId) {
    const v = rows.find((r) => r.vendorKey)?.vendorKey ?? `anbieter-${vendorId}`;
    label = v;
  } else if (year) {
    label = year;
  }
  if (year && vendorId) label = `${rows[0]?.vendorKey ?? vendorId}-${year}`;

  const filename = `infetch-rechnungen-${label}.zip`;

  return new Response(new Uint8Array(zipBuffer), {
    headers: {
      "content-type":        "application/zip",
      "content-disposition": `attachment; filename="${filename}"`,
      "content-length":      String(zipBuffer.length),
      "cache-control":       "no-store",
    },
  });
}
