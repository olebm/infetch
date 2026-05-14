import { sql } from "@/lib/db/client";

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

export async function matchVendor(signals: string[]): Promise<VendorMatch> {
  const haystack = signals.filter(Boolean).join("\n").toLowerCase();
  const aliases = await sql<AliasRow[]>`
    SELECT vendors.id AS "vendorId", vendors.name AS "vendorName", vendors.canonical_key AS "canonicalKey",
      vendor_aliases.alias, vendor_aliases.match_type AS "matchType", vendor_aliases.priority
    FROM vendor_aliases
    JOIN vendors ON vendors.id = vendor_aliases.vendor_id
    ORDER BY vendor_aliases.priority ASC, length(vendor_aliases.alias) DESC
  `;

  let best: (VendorMatch & { priority: number }) | null = null;

  for (const row of aliases) {
    const alias = row.alias.toLowerCase();
    const matched = row.matchType === "exact" ? haystack.split(/\s+/).includes(alias) : haystack.includes(alias);
    if (!matched) continue;

    const confidence = row.matchType === "domain" || row.matchType === "exact" ? 0.9 : 0.72;
    if (!best || confidence > best.confidence || row.priority < best.priority) {
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
