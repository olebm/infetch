import { NextRequest } from "next/server";
import archiver from "archiver";
import { Readable } from "node:stream";
import { unsafeGlobalSql as sql } from "@/lib/db/unsafe-global";
import { getCurrentAuth } from "@/lib/auth/current";
import { downloadFromStorage, BUCKETS } from "@/lib/supabase/storage";
import { canBulkDownload } from "@/lib/tier";

export const dynamic = "force-dynamic";

/**
 * Sanitisiert einen aus DB/Mail-Daten stammenden Pfadbestandteil für die
 * Verwendung als ZIP-Ordner/-Dateiname. Verhindert Zip-Slip
 * (`../`, absolute Pfade, NUL/Steuerzeichen, Trenner).
 */
function safeZipSegment(value: string, fallback: string): string {
  const base = value.split(/[\\/]/).pop() ?? "";
  const cleaned = base
    .replace(/[ -<>:"|?*]/g, "_")
    .replace(/^\.+/, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 120);
  return cleaned.length > 0 ? cleaned : fallback;
}

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
  // =, +, -, @, \t lösen in Excel/LibreOffice DDE-Ausführung aus.
  if (/^[=+\-@\t]/.test(s)) s = "'" + s;
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
  if (rawVendor !== null && (vendorId === null || isNaN(vendorId) || !Number.isInteger(vendorId) || vendorId <= 0)) {
    return new Response("Ungültiger vendorId-Parameter.", { status: 400 });
  }

  // SECURITY (INFETCH-87): Org-Scoping — nur Rechnungen der eigenen Organisation.
  // Ohne Org kein Export — verhindert dass Legacy-Daten (organization_id IS NULL)
  // an irgendeinen authentifizierten User geleakt werden.
  const orgId = auth.organization?.id ?? null;
  if (!orgId) {
    return new Response("Keine Organisation aktiv.", { status: 403 });
  }

  // Tier-Check: Bulk-Download (kein Vendor-Filter) ist Pro-only.
  // Free-User können Rechnungen pro Anbieter (vendorId gesetzt) herunterladen.
  if (!vendorId) {
    const bulkAllowed = await canBulkDownload(orgId);
    if (!bulkAllowed) {
      return new Response(
        JSON.stringify({ error: "bulk_download_not_allowed", message: "Bulk-Export ist nur im Pro-Plan verfügbar. Nutze den Download pro Anbieter." }),
        { status: 403, headers: { "content-type": "application/json" } },
      );
    }
  }

  // PERF (INFETCH-173): Eine konsolidierte Query mit conditional-WHERE statt
  // vier copy-paste-Varianten — kleinere Diffs, einfacher zu reviewen.
  // sql-Template-Tags lassen konditionale Fragments via verschachtelte sql``
  // zu (postgres.js): bei null-Werten greift der Vergleich nicht.
  const yearPattern = year ? year + "%" : null;
  const rows = await sql<InvoiceRow[]>`
    SELECT
      i.id              AS "invoiceId",
      i.invoice_date    AS "invoiceDate",
      i.created_at      AS "createdAt",
      i.invoice_number  AS "invoiceNumber",
      i.amount_gross    AS "amountGross",
      i.amount_net      AS "amountNet",
      i.vat_amount      AS "vatAmount",
      i.currency,
      i.status,
      v.name            AS "vendorName",
      v.canonical_key   AS "vendorKey",
      f.stored_path     AS "storedPath",
      f.original_filename AS "originalFilename"
    FROM invoices i
    LEFT JOIN vendors v ON v.id = i.vendor_id
    LEFT JOIN invoice_files f ON f.invoice_id = i.id
    WHERE i.status NOT IN ('ignored', 'duplicate')
      AND i.organization_id = ${orgId}
      AND (${yearPattern}::text IS NULL OR i.invoice_date LIKE ${yearPattern})
      AND (${vendorId}::bigint IS NULL OR i.vendor_id = ${vendorId})
    ORDER BY COALESCE(i.invoice_date, i.created_at::text) DESC
  `;

  if (rows.length === 0) {
    return new Response(
      "Keine Rechnungen für diesen Zeitraum gefunden.",
      { status: 404, headers: { "content-type": "text/plain; charset=utf-8" } },
    );
  }

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

  // PERF (INFETCH-173): Streaming-ZIP mit `archiver` statt In-Memory-JSZip.
  // Bei großen Exports (>1000 Rechnungen) wäre der In-Memory-ZIP-Aufbau ein
  // OOM-Risiko. archiver-output ist ein Node-Readable; wir konvertieren ihn
  // zu Web-ReadableStream und reichen ihn direkt als Response.body durch.
  // PDFs werden je File von Storage geladen und ohne dazwischenliegendes
  // Sammeln in den ZIP-Stream gepiped.
  const archive = archiver("zip", { zlib: { level: 6 } });

  // CSV-Metadaten zuerst — klein, immer dabei.
  archive.append(Buffer.from(buildCsv(rows), "utf-8"), { name: "rechnungen.csv" });

  // Async-Worker: PDFs nacheinander in den Stream pumpen, dann finalize().
  // Fehler beim Einzel-Download brechen den Gesamtexport nicht ab — die
  // CSV-Zeile bleibt drin, die PDF wird übersprungen (war auch im
  // JSZip-Vorgänger so).
  (async () => {
    for (const row of rows) {
      if (!row.storedPath) continue;
      try {
        const buffer = await downloadFromStorage(BUCKETS.INVOICES, row.storedPath);
        const folder = safeZipSegment(row.vendorKey ?? "", "unbekannt");
        const name = safeZipSegment(
          row.originalFilename ?? "",
          `rechnung-${row.invoiceId}.pdf`,
        );
        archive.append(buffer, { name: `${folder}/${name}` });
      } catch {
        // skip unreadable file — still included in CSV
      }
    }
    archive.finalize().catch(() => {
      // archiver wirft auch ohne await unmittelbar — sicherheitshalber catchen
    });
  })().catch(() => {
    // outer-loop-failure → archiver hart abbrechen
    archive.abort();
  });

  // Node-Readable → Web-ReadableStream für Next.js Response.
  const webStream = Readable.toWeb(archive) as unknown as ReadableStream<Uint8Array>;

  return new Response(webStream, {
    headers: {
      "content-type":        "application/zip",
      "content-disposition": `attachment; filename="${filename}"`,
      "cache-control":       "no-store",
      // Kein content-length — Stream ist unbekannte Größe; Browser fallen
      // automatisch auf chunked transfer encoding zurück.
    },
  });
}
