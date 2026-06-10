import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { sql } from "@/lib/db/client";
import {
  savePortalCredentialMeta,
  getPortalCredentialMetaMap,
  resetPortalCredentialMeta,
  listOnlineAccounts,
} from "@/portals/credential-meta";

// INFETCH-261: Die Online-Konten-Meta (Username) lag global in der settings-Map
// → Org B sah die Konten (Vendoren/Usernames) von Org A. Jetzt org-scoped unter
// `portal_credentials_meta:${orgId}`. Dieser Test fixiert die Isolation.

const SUFFIX = `${Date.now()}`;
const ORG_A = `meta-a-${SUFFIX}`;
const ORG_B = `meta-b-${SUFFIX}`;
const USER_A = `u-${ORG_A}`;
const USER_B = `u-${ORG_B}`;
const KEY_A = `va-${SUFFIX}`;
const KEY_B = `vb-${SUFFIX}`;

const hasDb = Boolean(process.env.DATABASE_URL);

async function seedOrgVendor(orgId: string, userId: string, key: string) {
  await sql`INSERT INTO users (id, email, name) VALUES (${userId}, ${`${userId}@meta.local`}, 'M') ON CONFLICT DO NOTHING`;
  await sql`
    INSERT INTO organizations (id, name, slug, tier, owner_user_id)
    VALUES (${orgId}, ${orgId}, ${orgId}, 'pro', ${userId}) ON CONFLICT DO NOTHING
  `;
  await sql`
    INSERT INTO vendors (name, canonical_key, category, organization_id)
    VALUES (${`V ${key}`}, ${key}, 'unknown', ${orgId}) ON CONFLICT DO NOTHING
  `;
}

async function cleanup() {
  // Auch den Legacy-Globalkey löschen, damit der migrations-sichere Fallback in
  // readOrgJsonSetting die Isolation nicht verfälscht.
  await sql`DELETE FROM settings WHERE key IN (${`portal_credentials_meta:${ORG_A}`}, ${`portal_credentials_meta:${ORG_B}`}, 'portal_credentials_meta')`;
  await sql`DELETE FROM vendors WHERE canonical_key IN (${KEY_A}, ${KEY_B})`;
  await sql`DELETE FROM organizations WHERE id IN (${ORG_A}, ${ORG_B})`;
  await sql`DELETE FROM users WHERE id IN (${USER_A}, ${USER_B})`;
}

describe.skipIf(!hasDb)("portal meta org isolation (INFETCH-261)", () => {
  beforeEach(async () => {
    await cleanup();
    await seedOrgVendor(ORG_A, USER_A, KEY_A);
    await seedOrgVendor(ORG_B, USER_B, KEY_B);
    await savePortalCredentialMeta({ vendorKey: KEY_A, username: "user-a", organizationId: ORG_A });
    await savePortalCredentialMeta({ vendorKey: KEY_B, username: "user-b", organizationId: ORG_B });
  });
  afterEach(cleanup);

  it("getPortalCredentialMetaMap ist org-scoped", async () => {
    const a = await getPortalCredentialMetaMap(ORG_A);
    expect(Object.keys(a)).toContain(KEY_A);
    expect(Object.keys(a)).not.toContain(KEY_B);

    const b = await getPortalCredentialMetaMap(ORG_B);
    expect(Object.keys(b)).toContain(KEY_B);
    expect(Object.keys(b)).not.toContain(KEY_A);
  });

  it("listOnlineAccounts zeigt Org B nicht die Konten von Org A", async () => {
    const a = (await listOnlineAccounts(ORG_A)).map((x) => x.vendorKey);
    expect(a).toContain(KEY_A);
    expect(a).not.toContain(KEY_B);

    const b = (await listOnlineAccounts(ORG_B)).map((x) => x.vendorKey);
    expect(b).toContain(KEY_B);
    expect(b).not.toContain(KEY_A);
  });

  it("resetPortalCredentialMeta entfernt nur aus der eigenen Org-Map", async () => {
    await resetPortalCredentialMeta(KEY_A, ORG_A);
    expect(Object.keys(await getPortalCredentialMetaMap(ORG_A))).not.toContain(KEY_A);
    // Org B bleibt unberührt.
    expect(Object.keys(await getPortalCredentialMetaMap(ORG_B))).toContain(KEY_B);
  });
});
