import type Database from "better-sqlite3";
import { recordSyncEvent } from "@/lib/db/events";

export type AliasBackfillResult = {
  scannedVendors: number;
  aliasesAdded: number;
  details: Array<{ vendorId: number; vendorName: string; alias: string }>;
};

type VendorRow = {
  vendorId: number;
  vendorName: string;
  canonicalKey: string;
  hasDomainAlias: number;
  hasExactAlias: number;
};

/**
 * Ergänzt fehlende Domain-Aliase für Vendors die bisher nur via 'contains'
 * gematcht wurden. Der Match-Confidence steigt von 0.72 auf 0.9 → mehr Belege
 * gehen durch den lokalen Pfad ohne Mistral-Call.
 *
 * Quelle: häufigste from_domain in Mail-Importen, die einem Vendor zugeordnet
 * wurden. Idempotent — bestehende Aliase werden ignoriert.
 */
export function backfillDomainAliases(db: Database.Database): AliasBackfillResult {
  // Vendors die einen Vendor-Match haben, aber keinen domain/exact Alias
  const vendors = db
    .prepare(
      `SELECT
         v.id AS vendorId,
         v.name AS vendorName,
         v.canonical_key AS canonicalKey,
         SUM(CASE WHEN a.match_type = 'domain' THEN 1 ELSE 0 END) AS hasDomainAlias,
         SUM(CASE WHEN a.match_type = 'exact' THEN 1 ELSE 0 END) AS hasExactAlias
       FROM vendors v
       LEFT JOIN vendor_aliases a ON a.vendor_id = v.id
       WHERE EXISTS (SELECT 1 FROM invoices i WHERE i.vendor_id = v.id)
       GROUP BY v.id, v.name, v.canonical_key
       HAVING hasDomainAlias = 0`,
    )
    .all() as VendorRow[];

  const result: AliasBackfillResult = {
    scannedVendors: vendors.length,
    aliasesAdded: 0,
    details: [],
  };

  const insertAlias = db.prepare(
    `INSERT OR IGNORE INTO vendor_aliases (vendor_id, alias, match_type, priority)
     VALUES (?, ?, 'domain', 50)`,
  );

  for (const vendor of vendors) {
    // Häufigste Domain in den Mails die zu Rechnungen dieses Vendors führten
    const domains = db
      .prepare(
        `SELECT m.from_address AS fromAddress, COUNT(*) AS uses
         FROM invoices i
         JOIN invoice_files f ON f.invoice_id = i.id
         JOIN mail_messages m ON m.id = CAST(f.source_ref_id AS INTEGER)
         WHERE i.vendor_id = ?
           AND f.source_type = 'mail'
           AND m.from_address IS NOT NULL
         GROUP BY m.from_address
         ORDER BY uses DESC
         LIMIT 1`,
      )
      .all(vendor.vendorId) as Array<{ fromAddress: string; uses: number }>;

    if (domains.length === 0) continue;
    const domain = domains[0].fromAddress.split("@").pop()?.toLowerCase();
    if (!domain || domain.length < 4) continue;

    const existing = db
      .prepare(`SELECT 1 FROM vendor_aliases WHERE vendor_id = ? AND alias = ? AND match_type = 'domain'`)
      .get(vendor.vendorId, domain);
    if (existing) continue;

    const inserted = insertAlias.run(vendor.vendorId, domain);
    if (inserted.changes > 0) {
      result.aliasesAdded++;
      result.details.push({
        vendorId: vendor.vendorId,
        vendorName: vendor.vendorName,
        alias: domain,
      });
      recordSyncEvent(db, {
        level: "info",
        eventType: "domain_alias_backfilled",
        vendorId: vendor.vendorId,
        message: `Domain-Alias "${domain}" für "${vendor.vendorName}" automatisch hinzugefügt.`,
        metadata: { alias: domain, basisUses: domains[0].uses },
      });
    }
  }

  return result;
}
