import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { sql } from "@/lib/db/client";
import { getMissingItems } from "@/lib/db/queries";

// INFETCH-246: Das "Fehlt"-Badge zählte rohe vendor_month_status-Zellen (10),
// die Liste (getMissingItems) filtert per Evidenz-Gate auf 0 → Badge ≠ Inhalt.
// Dieser Test nagelt das Evidenz-Gate fest: eine 'missing'-Zelle eines Vendors
// OHNE echte Rechnung darf NICHT mitzählen.

const hasDb = Boolean(process.env.DATABASE_URL);
const SUFFIX = `${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
const ORG = `org-miss-${SUFFIX}`;
const USER = `user-miss-${SUFFIX}`;
const KEY_A = `vendor-a-${SUFFIX}`; // mit Historie
const KEY_B = `vendor-b-${SUFFIX}`; // ohne Historie

async function seed() {
  await sql`INSERT INTO users (id, email, name) VALUES (${USER}, ${`${USER}@m.local`}, 'M') ON CONFLICT DO NOTHING`;
  await sql`INSERT INTO organizations (id, name, slug, tier, owner_user_id) VALUES (${ORG}, ${ORG}, ${ORG}, 'pro', ${USER}) ON CONFLICT DO NOTHING`;

  const mkVendor = async (key: string) => {
    const [v] = await sql<{ id: number }[]>`
      INSERT INTO vendors (name, canonical_key, category, organization_id)
      VALUES (${key}, ${key}, 'software', ${ORG}) RETURNING id`;
    return v.id;
  };
  const vendorA = await mkVendor(KEY_A);
  const vendorB = await mkVendor(KEY_B);

  // Evidenz nur für A: eine echte (exportierte) Rechnung im Vormonat.
  await sql`
    INSERT INTO invoices (organization_id, vendor_id, source, status, confidence, dedupe_key, invoice_date)
    VALUES (${ORG}, ${vendorA}, 'mail', 'exported', 0.9, ${`miss-${SUFFIX}`}, '2025-01-15')`;

  // Beide bekommen eine 'missing'-Zelle für einen abgeschlossenen Monat (→ fällig).
  const mkCell = (vendorId: number) => sql`
    INSERT INTO vendor_month_status (organization_id, vendor_id, year_month, mail_status, portal_status, manual_status, final_status, source_used)
    VALUES (${ORG}, ${vendorId}, '2025-01', 'missing', 'required', 'none', 'missing', 'none')`;
  await mkCell(vendorA);
  await mkCell(vendorB);
}

async function cleanup() {
  await sql`DELETE FROM vendor_month_status WHERE organization_id = ${ORG}`;
  await sql`DELETE FROM invoices WHERE organization_id = ${ORG}`;
  await sql`DELETE FROM vendors WHERE organization_id = ${ORG}`;
  await sql`DELETE FROM organizations WHERE id = ${ORG}`;
  await sql`DELETE FROM users WHERE id = ${USER}`;
}

describe.skipIf(!hasDb)("getMissingItems – Evidenz-Gate (INFETCH-246: Badge == Liste)", () => {
  beforeEach(async () => {
    await cleanup();
    await seed();
  });
  afterEach(cleanup);

  it("zählt nur Vendoren mit echter Historie — rohe missing-Zelle ohne Rechnung zählt NICHT", async () => {
    const items = await getMissingItems(ORG);
    // 2 rohe 'missing'-Zellen in der Org, aber nur Vendor A hat Evidenz → 1 Item.
    // (Das Badge = items.length zeigt damit dasselbe wie die Liste.)
    expect(items.length).toBe(1);
    expect(items[0].vendorCanonicalKey).toBe(KEY_A);
  });
});
