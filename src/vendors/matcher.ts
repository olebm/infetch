import { unsafeGlobalSql as sql } from "@/lib/db/unsafe-global";

export type VendorMatch = {
  vendorId: number | null;
  vendorName: string | null;
  canonicalKey: string | null;
  confidence: number;
};

type AliasRow = {
  vendorId: number;
  vendorName: string;
  canonicalKey: string;
  alias: string;
  matchType: "exact" | "contains" | "domain" | "regex";
  priority: number;
};

export async function matchVendor(signals: string[], organizationId?: string | null): Promise<VendorMatch> {
  const haystack = signals.filter(Boolean).join("\n").toLowerCase();
  // Org-aware: bei gesetzter Org NUR globale Seeds (organization_id NULL) und
  // Vendors DIESER Org berücksichtigen. Sonst könnte ein org-spezifischer Vendor
  // einer FREMDEN Org einer Rechnung zugeordnet werden — ein Cross-Tenant-Leak,
  // da getInvoiceDetail Vendors per unsafeGlobalSql ohne Org-Filter joint.
  // Default (kein Arg) = global wie bisher → abwärtskompatibel für Alt-Aufrufer.
  const aliases = await sql<AliasRow[]>`
    SELECT vendors.id AS "vendorId", vendors.name AS "vendorName", vendors.canonical_key AS "canonicalKey",
      vendor_aliases.alias, vendor_aliases.match_type AS "matchType", vendor_aliases.priority
    FROM vendor_aliases
    JOIN vendors ON vendors.id = vendor_aliases.vendor_id
    WHERE ${organizationId ?? null}::text IS NULL
       OR vendors.organization_id IS NULL
       OR vendors.organization_id = ${organizationId ?? null}
    ORDER BY vendor_aliases.priority ASC, length(vendor_aliases.alias) DESC
  `;

  let best: (VendorMatch & { priority: number }) | null = null;

  for (const row of aliases) {
    const alias = row.alias.toLowerCase();
    const matched = row.matchType === "exact" ? haystack.split(/\s+/).includes(alias) : haystack.includes(alias);
    if (!matched) continue;

    const confidence = row.matchType === "domain" || row.matchType === "exact" ? 0.9 : 0.72;
    // Höchste Confidence gewinnt; Priority ist NUR Tiebreak bei gleicher Confidence.
    // (Vorher überschrieb ein schwächerer Treffer mit niedrigerer Priority-Zahl
    //  fälschlich einen hochkonfidenten Domain/Exact-Treffer.)
    if (
      !best ||
      confidence > best.confidence ||
      (confidence === best.confidence && row.priority < best.priority)
    ) {
      best = {
        vendorId: row.vendorId,
        vendorName: row.vendorName,
        canonicalKey: row.canonicalKey,
        confidence,
        priority: row.priority,
      };
    }
  }

  if (!best) {
    return { vendorId: null, vendorName: null, canonicalKey: null, confidence: 0 };
  }

  return {
    vendorId: best.vendorId,
    vendorName: best.vendorName,
    canonicalKey: best.canonicalKey,
    confidence: best.confidence,
  };
}
