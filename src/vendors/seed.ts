import type Database from "better-sqlite3";
import { vendorSeeds } from "@/vendors/registry";

export function seedDatabase(db: Database.Database) {
  const insertVendor = db.prepare(`
    INSERT INTO vendors (name, canonical_key, category, portal_enabled, mail_enabled, manual_enabled)
    VALUES (@name, @canonicalKey, @category, 1, 1, 1)
    ON CONFLICT(canonical_key) DO UPDATE SET
      name = excluded.name,
      category = excluded.category,
      updated_at = CURRENT_TIMESTAMP
  `);

  const selectVendor = db.prepare<{ canonicalKey: string }, { id: number }>(
    `SELECT id FROM vendors WHERE canonical_key = @canonicalKey`,
  );

  const insertAlias = db.prepare(`
    INSERT INTO vendor_aliases (vendor_id, alias, match_type, priority)
    VALUES (@vendorId, @alias, @matchType, @priority)
    ON CONFLICT(vendor_id, alias, match_type) DO UPDATE SET priority = excluded.priority
  `);

  const insertExportTarget = db.prepare(`
    INSERT INTO export_targets (target, label, recipient_email, enabled)
    VALUES (@target, @label, NULL, 0)
    ON CONFLICT(target) DO UPDATE SET label = excluded.label
  `);

  const tx = db.transaction(() => {
    for (const vendor of vendorSeeds) {
      insertVendor.run(vendor);
      const row = selectVendor.get({ canonicalKey: vendor.canonicalKey });
      if (!row) continue;

      for (const alias of vendor.aliases) {
        insertAlias.run({
          vendorId: row.id,
          alias: alias.alias,
          matchType: alias.matchType || "contains",
          priority: alias.priority || 100,
        });
      }
    }

    insertExportTarget.run({ target: "kontist", label: "Kontist" });
    insertExportTarget.run({ target: "accountable", label: "Accountable" });
  });

  tx();
}
