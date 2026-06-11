import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Tier-Gates greifen nur, wenn billing.proEnabled true ist — im Free-only-Launch
// klemmt getOrgTier sonst alles auf "free". Wie quota.test.ts mocken wir das.
vi.mock("@/lib/config/env", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/config/env")>();
  return {
    ...actual,
    appConfig: {
      ...actual.appConfig,
      billing: { ...actual.appConfig.billing, proEnabled: true },
    },
  };
});

import { sql } from "@/lib/db/client";
import { canAddOnlineAccount, getOnlineAccountCount } from "@/lib/tier";
import { filterEntitledPortalAccounts } from "@/lib/auto-pilot";
import { getPortalAccountOrg } from "@/portals/credential-meta";
import { buildSecretRef } from "@/lib/secrets/credential-store";

const hasDb = Boolean(process.env.DATABASE_URL);
const SUFFIX = `${Date.now()}`;

async function seedOrg(id: string, tier: "free" | "pro" | "business") {
  const userId = `u-${id}`;
  await sql`INSERT INTO users (id, email, name) VALUES (${userId}, ${`${userId}@tg.local`}, 'TG') ON CONFLICT DO NOTHING`;
  await sql`
    INSERT INTO organizations (id, name, slug, tier, owner_user_id)
    VALUES (${id}, ${id}, ${id}, ${tier}, ${userId})
    ON CONFLICT (id) DO UPDATE SET tier = EXCLUDED.tier
  `;
}

async function seedPortalAccount(orgId: string, vendorKey: string) {
  // Realistischer secret_ref via buildSecretRef — GEHASHT, enthält den vendorKey
  // NICHT im Klartext (wie in Prod). owner_id trägt den Klartext-vendorKey. So
  // fängt der Test eine Rückkehr zu secret_ref-LIKE (INFETCH-262).
  const secretRef = buildSecretRef("portal", vendorKey, orgId);
  await sql`
    INSERT INTO credential_refs (scope, owner_id, label, secret_store, secret_ref, status, organization_id)
    VALUES ('portal', ${vendorKey}, ${`${vendorKey} portal`}, 'encrypted_db', ${secretRef}, 'configured', ${orgId})
  `;
}

const ORG_FREE = `tg-free-${SUFFIX}`;
const ORG_PRO = `tg-pro-${SUFFIX}`;
const ORG_BIZ = `tg-biz-${SUFFIX}`;
const ALL_ORGS = [ORG_FREE, ORG_PRO, ORG_BIZ];

async function cleanup() {
  await sql`DELETE FROM credential_refs WHERE organization_id = ANY(${ALL_ORGS}::text[])`;
  await sql`DELETE FROM organizations WHERE id = ANY(${ALL_ORGS}::text[])`;
  await sql`DELETE FROM users WHERE id = ANY(${ALL_ORGS.map((o) => `u-${o}`)}::text[])`;
}

describe.skipIf(!hasDb)("portal tier gating (INFETCH-252)", () => {
  beforeEach(async () => {
    await cleanup();
    await seedOrg(ORG_FREE, "free");
    await seedOrg(ORG_PRO, "pro");
    await seedOrg(ORG_BIZ, "business");
  });
  afterEach(cleanup);

  it("Limits pro Tier: Free 0 / Pro 5 / Business 20", async () => {
    expect((await canAddOnlineAccount(ORG_FREE)).max).toBe(0);
    expect((await canAddOnlineAccount(ORG_PRO)).max).toBe(5);
    expect((await canAddOnlineAccount(ORG_BIZ)).max).toBe(20);
  });

  it("Free darf nie ein Online-Konto anlegen (max 0)", async () => {
    const limit = await canAddOnlineAccount(ORG_FREE);
    expect(limit.allowed).toBe(false);
    expect(limit.current).toBe(0);
  });

  it("Pro: unter Limit erlaubt, am Limit gesperrt", async () => {
    expect((await canAddOnlineAccount(ORG_PRO)).allowed).toBe(true);
    for (let i = 0; i < 5; i++) await seedPortalAccount(ORG_PRO, `pro-v${i}-${SUFFIX}`);
    const atLimit = await canAddOnlineAccount(ORG_PRO);
    expect(atLimit.current).toBe(5);
    expect(atLimit.allowed).toBe(false);
  });

  it("getOnlineAccountCount ist org-scoped (kein Cross-Tenant-Zählfehler)", async () => {
    await seedPortalAccount(ORG_PRO, `pro-a-${SUFFIX}`);
    await seedPortalAccount(ORG_PRO, `pro-b-${SUFFIX}`);
    await seedPortalAccount(ORG_BIZ, `biz-a-${SUFFIX}`);
    expect(await getOnlineAccountCount(ORG_PRO)).toBe(2);
    expect(await getOnlineAccountCount(ORG_BIZ)).toBe(1);
    expect(await getOnlineAccountCount(ORG_FREE)).toBe(0);
  });

  it("getPortalAccountOrg löst über owner_id auf (secret_ref ist gehasht — INFETCH-262)", async () => {
    const vk = `resolve-${SUFFIX}`;
    await seedPortalAccount(ORG_PRO, vk);
    expect(await getPortalAccountOrg(vk)).toBe(ORG_PRO);
    expect(await getPortalAccountOrg(`nope-${SUFFIX}`)).toBeNull();
  });

  describe("filterEntitledPortalAccounts (Cron-Gating)", () => {
    it("überspringt Konten von Free-Orgs (kein Abruf)", async () => {
      const vk = `free-v-${SUFFIX}`;
      await seedPortalAccount(ORG_FREE, vk);
      const result = await filterEntitledPortalAccounts([
        { vendorKey: vk, updatedAt: "2026-01-01" },
      ]);
      expect(result).toHaveLength(0);
    });

    it("überspringt verwaiste Konten ohne Org", async () => {
      const result = await filterEntitledPortalAccounts([
        { vendorKey: `orphan-${SUFFIX}`, updatedAt: "2026-01-01" },
      ]);
      expect(result).toHaveLength(0);
    });

    it("begrenzt eine Pro-Org auf 5 Konten (älteste zuerst) — Downgrade-Schutz", async () => {
      const keys = Array.from({ length: 6 }, (_, i) => `pro-c${i}-${SUFFIX}`);
      for (const k of keys) await seedPortalAccount(ORG_PRO, k);
      // updatedAt aufsteigend: c0 ältestes … c5 jüngstes → c0..c4 aktiv, c5 raus.
      const accounts = keys.map((k, i) => ({
        vendorKey: k,
        updatedAt: `2026-01-0${i + 1}`,
      }));
      const result = await filterEntitledPortalAccounts(accounts);
      expect(result).toHaveLength(5);
      expect(result.map((a) => a.vendorKey)).not.toContain(keys[5]);
    });

    it("lässt Konten einer berechtigten Pro-Org durch", async () => {
      const vk = `pro-ok-${SUFFIX}`;
      await seedPortalAccount(ORG_PRO, vk);
      const result = await filterEntitledPortalAccounts([
        { vendorKey: vk, updatedAt: "2026-01-01" },
      ]);
      expect(result.map((a) => a.vendorKey)).toEqual([vk]);
    });
  });
});
