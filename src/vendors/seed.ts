import { sql } from "@/lib/db/client";
import { vendorSeeds } from "@/vendors/registry";

export async function seedDatabase() {
  for (const vendor of vendorSeeds) {
    await sql`
      INSERT INTO vendors (name, canonical_key, category, portal_enabled, mail_enabled, manual_enabled)
      VALUES (${vendor.name}, ${vendor.canonicalKey}, ${vendor.category}, TRUE, TRUE, TRUE)
      ON CONFLICT(canonical_key) DO UPDATE SET
        name = excluded.name,
        category = excluded.category,
        updated_at = CURRENT_TIMESTAMP
    `;

    const rows = await sql<{ id: number }[]>`
      SELECT id FROM vendors WHERE canonical_key = ${vendor.canonicalKey}
    `;
    const row = rows[0];
    if (!row) continue;

    for (const alias of vendor.aliases) {
      await sql`
        INSERT INTO vendor_aliases (vendor_id, alias, match_type, priority)
        VALUES (${row.id}, ${alias.alias}, ${alias.matchType || "contains"}, ${alias.priority || 100})
        ON CONFLICT(vendor_id, alias, match_type) DO UPDATE SET priority = excluded.priority
      `;
    }
  }

  await sql`
    INSERT INTO export_targets (target, label, recipient_email, enabled)
    VALUES ('kontist', 'Kontist', NULL, FALSE)
    ON CONFLICT(target) DO UPDATE SET label = excluded.label
  `;

  await sql`
    INSERT INTO export_targets (target, label, recipient_email, enabled)
    VALUES ('accountable', 'Accountable', NULL, FALSE)
    ON CONFLICT(target) DO UPDATE SET label = excluded.label
  `;
}
