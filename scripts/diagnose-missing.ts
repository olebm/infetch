/**
 * Read-only Diagnose: WARUM fehlt eine Rechnung in der "fehlt"-Matrix, obwohl
 * sie real existiert? Klassifiziert die wahrscheinliche Ursache pro Org.
 *
 * Reiner SELECT-Pfad — KEINE Writes. Aufruf:
 *   tsx scripts/diagnose-missing.ts <organizationId>
 *
 * Hintergrund (siehe CORE_ARCHITECTURE): die "fehlt"-Matrix zählt einen Monat
 * nur als vorhanden, wenn eine Rechnung mit vendor_id (zugeordnet) + Datum
 * existiert. Fehlt sie, liegt es meist an einem von vier Mustern, die dieses
 * Skript sichtbar macht.
 */
import { sql } from "../src/lib/db/client";

const orgId = process.argv[2];
if (!orgId) {
  console.error("Usage: tsx scripts/diagnose-missing.ts <organizationId>");
  process.exit(1);
}

function header(title: string) {
  console.log(`\n${"─".repeat(72)}\n${title}\n${"─".repeat(72)}`);
}

// ── 1. Importiert, aber KEINEM Vendor zugeordnet (awork-Muster) ───────────────
// Rechnung liegt im System, vendor_id IS NULL → für die "fehlt"-Matrix
// unsichtbar, obwohl sie da ist. Mit Absender-Domain + KI-geratenem Namen.
const unrecognized = await sql<
  Array<{
    id: number;
    invoiceDate: string | null;
    status: string;
    filename: string | null;
    senderDomain: string | null;
    aiVendor: string | null;
  }>
>`
  SELECT
    i.id,
    i.invoice_date AS "invoiceDate",
    i.status,
    (SELECT original_filename FROM invoice_files WHERE invoice_id = i.id ORDER BY id DESC LIMIT 1) AS filename,
    (
      SELECT lower(substring(mm.from_address from '@([A-Za-z0-9.-]+)'))
      FROM invoice_files f
      JOIN mail_messages mm ON mm.id = (CASE WHEN f.source_ref_id ~ '^[0-9]+$' THEN f.source_ref_id::bigint END)
      WHERE f.invoice_id = i.id AND f.source_type = 'mail' AND mm.from_address IS NOT NULL
      ORDER BY f.id DESC LIMIT 1
    ) AS "senderDomain",
    (
      SELECT COALESCE(ae.output_json::jsonb->>'normalized_vendor', ae.output_json::jsonb->>'vendor')
      FROM ai_extractions ae
      WHERE ae.invoice_id = i.id AND ae.status = 'succeeded'
      ORDER BY ae.created_at DESC, ae.id DESC LIMIT 1
    ) AS "aiVendor"
  FROM invoices i
  WHERE i.organization_id = ${orgId}
    AND i.vendor_id IS NULL
    AND i.status NOT IN ('ignored', 'duplicate', 'failed')
  ORDER BY i.invoice_date DESC NULLS LAST
  LIMIT 200
`;

header(`1) Importiert, aber NICHT zugeordnet (vendor_id NULL) — ${unrecognized.length}`);
console.log("   → Diese Rechnungen SIND da, zählen aber nicht (awork-Muster).");
for (const r of unrecognized) {
  console.log(
    `   #${r.id}  ${r.invoiceDate ?? "ohne Datum"}  [${r.status}]  ` +
      `Domain=${r.senderDomain ?? "—"}  KI-Name=${r.aiVendor ?? "—"}  ${r.filename ?? ""}`,
  );
}

// ── 2. Sender mit PDFs, aber ohne Vendor (Auto-Assign-Kandidaten) ─────────────
const unmatchedSenders = await sql<
  Array<{
    fromAddress: string;
    fromDomain: string;
    pdfCount: number;
    importedCount: number;
  }>
>`
  SELECT from_address AS "fromAddress", from_domain AS "fromDomain",
    pdf_count AS "pdfCount", imported_count AS "importedCount"
  FROM discovered_senders
  WHERE organization_id = ${orgId}
    AND matched_vendor_id IS NULL
    AND blocked = FALSE
    AND pdf_count > 0
  ORDER BY pdf_count DESC
  LIMIT 100
`;

header(`2) Sender mit PDFs, aber ohne Vendor — ${unmatchedSenders.length}`);
console.log("   → Der Auto-Assign-Lever würde hierfür Vendors anlegen.");
for (const s of unmatchedSenders) {
  console.log(
    `   ${s.fromAddress}  (Domain ${s.fromDomain})  PDFs=${s.pdfCount}  importiert=${s.importedCount}`,
  );
}

// ── 3. Blockierte Sender mit PDFs (übersprungen) ──────────────────────────────
const blockedSenders = await sql<
  Array<{
    fromAddress: string;
    pdfCount: number;
    blockedReason: string | null;
  }>
>`
  SELECT from_address AS "fromAddress", pdf_count AS "pdfCount", blocked_reason AS "blockedReason"
  FROM discovered_senders
  WHERE organization_id = ${orgId} AND blocked = TRUE AND pdf_count > 0
  ORDER BY pdf_count DESC
  LIMIT 100
`;

header(`3) Blockierte Sender mit PDFs — ${blockedSenders.length}`);
console.log("   → Deren Anhänge werden bewusst übersprungen.");
for (const s of blockedSenders) {
  console.log(`   ${s.fromAddress}  PDFs=${s.pdfCount}  Grund=${s.blockedReason ?? "—"}`);
}

// ── 4. Mails ohne PDF-Anhang (Link-/Portal-Rechnungen wie Adobe) ──────────────
// Datenminimierung: für Mails OHNE erkannte Rechnung speichert der Scanner den
// Absender NICHT (nur einen UID-Marker). Wir können daher nur die ANZAHL der
// no_pdf-Mails zeigen, nicht von wem — Link-Rechnungen (Adobe) sind hier
// strukturell nicht attribuierbar und müssen im Postfach geprüft werden.
const noPdf = await sql<Array<{ noPdfCount: string }>>`
  SELECT COUNT(*) AS "noPdfCount"
  FROM mail_messages mm
  JOIN mail_accounts ma ON ma.id = mm.mail_account_id
  WHERE ma.organization_id = ${orgId} AND mm.status = 'no_pdf'
`;

header(`4) Mails ohne PDF-Anhang — ${noPdf[0]?.noPdfCount ?? 0}`);
console.log("   → Kandidaten für Link-/Portal-Rechnungen (z. B. Adobe).");
console.log("   → Absender werden aus Datenschutzgründen NICHT gespeichert —");
console.log("     diese Fälle bitte direkt im Postfach prüfen (Anhang vs. Link).");

console.log("\nFertig (read-only, keine Änderungen).");
await sql.end({ timeout: 5 });
