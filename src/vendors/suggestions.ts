import { sql } from "@/lib/db/client";

export type VendorSuggestion = {
  vendorId: number;
  vendorName: string;
  reason: "sender_history" | "domain_alias" | "name_in_text" | "filename_pattern";
  detail: string;
  score: number;
};

type InvoiceContext = {
  invoiceId: number;
  filename: string | null;
  fromAddress: string | null;
  rawTextPath: string | null;
};

async function loadInvoiceContext(invoiceId: number, organizationId: string | null): Promise<InvoiceContext> {
  // Wenn keine Org angegeben ist: kein Context — sonst könnten Suggestions
  // für Invoices fremder Orgs geladen werden.
  if (!organizationId) {
    return { invoiceId, filename: null, fromAddress: null, rawTextPath: null };
  }
  const rows = await sql<InvoiceContext[]>`
    SELECT i.id AS "invoiceId",
           i.raw_text_path AS "rawTextPath",
           (SELECT inf.original_filename FROM invoice_files inf
            WHERE inf.invoice_id = i.id ORDER BY inf.created_at DESC LIMIT 1) AS filename,
           (SELECT mm.from_address FROM invoice_files inf
            LEFT JOIN mail_messages mm ON CAST(mm.id AS TEXT) = inf.source_ref_id
            WHERE inf.invoice_id = i.id AND inf.source_type = 'mail'
            ORDER BY inf.created_at DESC LIMIT 1) AS "fromAddress"
    FROM invoices i
    WHERE i.id = ${invoiceId}
      AND i.organization_id = ${organizationId}
  `;
  return rows[0] ?? { invoiceId, filename: null, fromAddress: null, rawTextPath: null };
}

function extractDomain(value: string | null): string | null {
  if (!value) return null;
  const match = value.match(/<?\s*([\w.+-]+)@([\w.-]+)\s*>?/);
  return match ? match[2].toLowerCase() : null;
}

/**
 * Gibt Top-3 Vendor-Vorschlaege fuer eine Rechnung mit unbekanntem oder
 * unsicherem Vendor. Quellen (in Reihenfolge der Score-Staerke):
 *
 *   1. Sender-History: andere Rechnungen vom gleichen Sender → wie oft welcher Vendor?
 *   2. Domain-Alias: Sender-Domain matched einen vorhandenen Domain-Alias
 *   3. Name-in-Text: Vendor-Name kommt im PDF-Text vor
 *   4. Filename-Pattern: Vendor-Name oder canonical_key im Filename
 */
export async function getVendorSuggestions(
  invoiceId: number,
  limit = 3,
  organizationId: string | null = null,
): Promise<VendorSuggestion[]> {
  // Ohne Org-Kontext keine Suggestions liefern — sonst leaken Vendor-Daten
  // (Namen, canonical_keys, Domain-Aliases) anderer Mandanten.
  if (!organizationId) return [];

  const ctx = await loadInvoiceContext(invoiceId, organizationId);
  const suggestions = new Map<number, VendorSuggestion>();

  function add(suggestion: VendorSuggestion) {
    const existing = suggestions.get(suggestion.vendorId);
    if (!existing || suggestion.score > existing.score) {
      suggestions.set(suggestion.vendorId, suggestion);
    }
  }

  // 1. Sender-History — staerkster Hinweis (gleicher Sender, schon mal Vendor X)
  if (ctx.fromAddress) {
    const rows = await sql<Array<{ vendorId: number; vendorName: string; hits: string }>>`
      SELECT v.id AS "vendorId", v.name AS "vendorName", COUNT(*) AS hits
      FROM invoices i2
      JOIN invoice_files inf ON inf.invoice_id = i2.id
      LEFT JOIN mail_messages mm ON CAST(mm.id AS TEXT) = inf.source_ref_id
      JOIN vendors v ON v.id = i2.vendor_id
      WHERE LOWER(mm.from_address) = LOWER(${ctx.fromAddress})
        AND i2.id != ${invoiceId}
        AND i2.vendor_id IS NOT NULL
        AND i2.organization_id = ${organizationId}
        AND (v.organization_id IS NULL OR v.organization_id = ${organizationId})
      GROUP BY v.id, v.name
      ORDER BY hits DESC
      LIMIT 3
    `;
    for (const row of rows) {
      const hits = Number(row.hits);
      add({
        vendorId: row.vendorId,
        vendorName: row.vendorName,
        reason: "sender_history",
        detail: `Schon ${hits}× von ${ctx.fromAddress} zugeordnet`,
        score: 0.95 + Math.min(0.04, hits * 0.005),
      });
    }
  }

  // 2. Domain-Alias — Sender-Domain matched bekannten Domain-Alias
  const senderDomain = extractDomain(ctx.fromAddress);
  if (senderDomain) {
    const rows = await sql<Array<{ vendorId: number; vendorName: string }>>`
      SELECT v.id AS "vendorId", v.name AS "vendorName"
      FROM vendor_aliases va
      JOIN vendors v ON v.id = va.vendor_id
      WHERE va.match_type = 'domain' AND LOWER(va.alias) = ${senderDomain}
        AND (v.organization_id IS NULL OR v.organization_id = ${organizationId})
      LIMIT 1
    `;
    const row = rows[0];
    if (row) {
      add({
        vendorId: row.vendorId,
        vendorName: row.vendorName,
        reason: "domain_alias",
        detail: `Sender-Domain ${senderDomain} ist Alias fuer ${row.vendorName}`,
        score: 0.88,
      });
    }
  }

  // 3. Filename-Pattern — Vendor-Key oder Name im Dateinamen
  if (ctx.filename) {
    const lowerFilename = ctx.filename.toLowerCase();
    const vendorRows = await sql<Array<{ id: number; name: string; canonicalKey: string }>>`
      SELECT id, name, canonical_key AS "canonicalKey" FROM vendors
      WHERE organization_id IS NULL OR organization_id = ${organizationId}
    `;
    for (const v of vendorRows) {
      const nameLower = v.name.toLowerCase().replace(/\s+/g, "");
      const keyLower = v.canonicalKey.toLowerCase();
      if (lowerFilename.includes(keyLower) || lowerFilename.includes(nameLower)) {
        add({
          vendorId: v.id,
          vendorName: v.name,
          reason: "filename_pattern",
          detail: `Dateiname enthaelt "${v.name}"`,
          score: 0.72,
        });
      }
    }
  }

  // 4. (optional) Name-in-Text — wuerde PDF-Text laden; verzichtbar fuer Top-3
  //    da Hebel 1-3 meistens schon ausreichen. Wenn doch noetig: rawTextPath lesen + token-match.

  return Array.from(suggestions.values())
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);
}
