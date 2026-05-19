import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { sql } from "@/lib/db/client";
import { getVendors, getMissingItems, getMissingMatrix } from "@/lib/db/queries";

// Regressionstest für Mandanten-Isolation der Lieferanten-/Missing-Queries.
// Der App-Pfad nutzt den service_role-Client und umgeht RLS — die Trennung
// hängt am organization_id-Filter im Query-Code. Dieser Test fixiert den
// Kontrakt: Org A darf org-eigene Vendoren bzw. den Missing-Status-Cache von
// Org B niemals sehen.

const SUFFIX = `${Date.now()}`;
const ORG_A = `org-a-vq-${SUFFIX}`;
const ORG_B = `org-b-vq-${SUFFIX}`;
const USER_A = `user-a-vq-${SUFFIX}`;
const USER_B = `user-b-vq-${SUFFIX}`;
const KEY_A = `vendor-a-vq-${SUFFIX}`;
const KEY_B = `vendor-b-vq-${SUFFIX}`;
const YM = "2099-01"; // außerhalb jedes realen Fensters, kollidiert mit nichts

const hasDb = Boolean(process.env.DATABASE_URL);

async function seedOrgWithVendor(orgId: string, userId: string, key: string): Promise<number> {
  await sql`INSERT INTO users (id, email, name) VALUES (${userId}, ${`${userId}@iso.local`}, 'Iso') ON CONFLICT DO NOTHING`;
  await sql`
    INSERT INTO organizations (id, name, slug, tier, owner_user_id)
    VALUES (${orgId}, ${orgId}, ${orgId}, 'pro', ${userId})
    ON CONFLICT DO NOTHING
  `;
  const [vendor] = await sql<{ id: number }[]>`
    INSERT INTO vendors (name, canonical_key, category, organization_id)
    VALUES (${`Vendor ${key}`}, ${key}, 'unknown', ${orgId})
    RETURNING id
  `;
  await sql`
    INSERT INTO vendor_month_status
      (vendor_id, year_month, mail_status, portal_status, manual_status, final_status, source_used, organization_id)
    VALUES
      (${vendor.id}, ${YM}, 'missing', 'not_needed', 'none', 'missing', 'none', ${orgId})
  `;
  return Number(vendor.id);
}

async function cleanup() {
  await sql`DELETE FROM vendor_month_status WHERE organization_id IN (${ORG_A}, ${ORG_B})`;
  await sql`DELETE FROM vendors WHERE canonical_key IN (${KEY_A}, ${KEY_B})`;
  await sql`DELETE FROM organizations WHERE id IN (${ORG_A}, ${ORG_B})`;
  await sql`DELETE FROM users WHERE id IN (${USER_A}, ${USER_B})`;
}

describe.skipIf(!hasDb)("tenant isolation — vendor & missing queries", () => {
  let vendorA = 0;
  let vendorB = 0;

  beforeEach(async () => {
    await cleanup();
    vendorA = await seedOrgWithVendor(ORG_A, USER_A, KEY_A);
    vendorB = await seedOrgWithVendor(ORG_B, USER_B, KEY_B);
  });
  afterEach(cleanup);

  it("getVendors: caller sees its own org vendor but not another org's", async () => {
    const idsA = (await getVendors(ORG_A)).map((v) => v.id);
    expect(idsA).toContain(vendorA);
    expect(idsA).not.toContain(vendorB);

    const idsB = (await getVendors(ORG_B)).map((v) => v.id);
    expect(idsB).toContain(vendorB);
    expect(idsB).not.toContain(vendorA);
  });

  it("getVendors: a null-org caller sees neither org's private vendor", async () => {
    const ids = (await getVendors(null)).map((v) => v.id);
    expect(ids).not.toContain(vendorA);
    expect(ids).not.toContain(vendorB);
  });

  it("getMissingItems: caller sees only its own org's missing status", async () => {
    const idsA = (await getMissingItems(ORG_A)).map((m) => m.vendorId);
    expect(idsA).toContain(vendorA);
    expect(idsA).not.toContain(vendorB);

    const idsB = (await getMissingItems(ORG_B)).map((m) => m.vendorId);
    expect(idsB).toContain(vendorB);
    expect(idsB).not.toContain(vendorA);
  });

  it("getMissingMatrix: caller's matrix never lists another org's vendor", async () => {
    const matrixA = await getMissingMatrix(ORG_A, true);
    const matrixIdsA = matrixA.map((r) => r.vendor.id);
    expect(matrixIdsA).toContain(vendorA);
    expect(matrixIdsA).not.toContain(vendorB);

    const matrixB = await getMissingMatrix(ORG_B, true);
    const matrixIdsB = matrixB.map((r) => r.vendor.id);
    expect(matrixIdsB).toContain(vendorB);
    expect(matrixIdsB).not.toContain(vendorA);
  });
});
