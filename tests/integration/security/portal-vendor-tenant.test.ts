import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { sql } from "@/lib/db/client";
import { findVendorByCanonicalKey, getVendors, upsertVendor } from "@/lib/db/queries";

// INFETCH-236: Der Portal-Connect-Pfad legte den Vendor global an
// (organization_id NULL) → Org B sah Namen + Login-URL des Portals von Org A.
// Dieser Test fixiert den Kontrakt: ein über upsertVendor (Connect) angelegter
// Vendor ist strikt org-eigen und für andere Orgs unsichtbar/unauflösbar.
//
// Der App-Pfad nutzt den service_role-Client (unsafeGlobalSql) und umgeht RLS —
// die Trennung hängt am organization_id-Filter im Query-Code, nicht an Policies.

const SUFFIX = `${Date.now()}`;
const ORG_A = `org-a-pv-${SUFFIX}`;
const ORG_B = `org-b-pv-${SUFFIX}`;
const USER_A = `user-a-pv-${SUFFIX}`;
const USER_B = `user-b-pv-${SUFFIX}`;
const KEY = `stadtwerke-pv-${SUFFIX}`;
const GLOBAL_KEY = `global-builtin-pv-${SUFFIX}`;

const hasDb = Boolean(process.env.DATABASE_URL);

async function seedOrg(orgId: string, userId: string) {
  await sql`INSERT INTO users (id, email, name) VALUES (${userId}, ${`${userId}@iso.local`}, 'PV') ON CONFLICT DO NOTHING`;
  await sql`
    INSERT INTO organizations (id, name, slug, tier, owner_user_id)
    VALUES (${orgId}, ${orgId}, ${orgId}, 'pro', ${userId})
    ON CONFLICT DO NOTHING
  `;
}

async function cleanup() {
  // Org-eigene Zeilen tragen org_id; der globale Built-in zusätzlich per Key.
  await sql`DELETE FROM vendors WHERE organization_id IN (${ORG_A}, ${ORG_B}) OR canonical_key = ${GLOBAL_KEY}`;
  await sql`DELETE FROM organizations WHERE id IN (${ORG_A}, ${ORG_B})`;
  await sql`DELETE FROM users WHERE id IN (${USER_A}, ${USER_B})`;
}

describe.skipIf(!hasDb)("portal vendor tenant isolation (INFETCH-236)", () => {
  beforeEach(async () => {
    await cleanup();
    await seedOrg(ORG_A, USER_A);
    await seedOrg(ORG_B, USER_B);
  });
  afterEach(cleanup);

  it("upsertVendor stempelt die aufrufende Org (nie global NULL)", async () => {
    const v = await upsertVendor({
      name: "Stadtwerke Musterstadt",
      canonicalKey: KEY,
      organizationId: ORG_A,
      portalLoginUrl: "https://portal.example/login",
    });
    expect(v.organizationId).toBe(ORG_A);

    const [row] = await sql<{ organization_id: string | null }[]>`
      SELECT organization_id FROM vendors WHERE canonical_key = ${KEY}`;
    expect(row.organization_id).toBe(ORG_A);
  });

  it("findVendorByCanonicalKey: Org B kann den Portal-Vendor von Org A nicht auflösen", async () => {
    await upsertVendor({
      name: "Stadtwerke",
      canonicalKey: KEY,
      organizationId: ORG_A,
      portalLoginUrl: "https://portal.example/login",
    });
    expect(await findVendorByCanonicalKey(KEY, ORG_A)).not.toBeNull();
    expect(await findVendorByCanonicalKey(KEY, ORG_B)).toBeNull();
  });

  it("getVendors: Org A's Portal-Vendor taucht nie in Org B's Liste auf", async () => {
    await upsertVendor({
      name: "Stadtwerke",
      canonicalKey: KEY,
      organizationId: ORG_A,
      portalLoginUrl: "https://portal.example/login",
    });
    const keysB = (await getVendors(ORG_B)).map((v) => v.canonicalKey);
    expect(keysB).not.toContain(KEY);
    const keysA = (await getVendors(ORG_A)).map((v) => v.canonicalKey);
    expect(keysA).toContain(KEY);
  });

  it("upsertVendor mutiert niemals eine globale Built-in-Zeile", async () => {
    await sql`
      INSERT INTO vendors (name, canonical_key, category, organization_id)
      VALUES ('Global Telekom', ${GLOBAL_KEY}, 'telco', NULL)`;
    // Org A „verbindet" — darf den globalen Row NICHT mit Login-URL überschreiben,
    // sondern bekommt eine org-eigene Zeile mit eigenem Key (so wie es die Action
    // über generateCanonicalKey tut).
    const orgKey = `${GLOBAL_KEY}-org`;
    await upsertVendor({
      name: "Global Telekom",
      canonicalKey: orgKey,
      organizationId: ORG_A,
      portalLoginUrl: "https://telekom.example/login",
    });
    const [globalRow] = await sql<
      { organization_id: string | null; portal_login_url: string | null }[]
    >`
      SELECT organization_id, portal_login_url FROM vendors WHERE canonical_key = ${GLOBAL_KEY}`;
    expect(globalRow.organization_id).toBeNull();
    expect(globalRow.portal_login_url).toBeNull(); // globaler Row unangetastet
  });

  it("Cron-Pfad: findVendorByCanonicalKey ohne Org löst weiter auf (global eindeutiger Key)", async () => {
    await upsertVendor({
      name: "Stadtwerke",
      canonicalKey: KEY,
      organizationId: ORG_A,
      portalLoginUrl: "https://portal.example/login",
    });
    const v = await findVendorByCanonicalKey(KEY); // kein Org-Arg = System/Cron
    expect(v?.canonicalKey).toBe(KEY);
  });
});
