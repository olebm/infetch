import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Tier-Gates greifen nur bei proEnabled — sonst klemmt getOrgTier auf "free".
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
import { canRecordPortalRecipe, getMonthlyPortalRecordingCount } from "@/lib/tier";

const hasDb = Boolean(process.env.DATABASE_URL);
const SUFFIX = `${Date.now()}`;

const ORG_FREE = `mb-free-${SUFFIX}`;
const ORG_PRO = `mb-pro-${SUFFIX}`;
const ORG_BIZ = `mb-biz-${SUFFIX}`;
const ALL = [ORG_FREE, ORG_PRO, ORG_BIZ];

async function seedOrg(id: string, tier: "free" | "pro" | "business") {
  const userId = `u-${id}`;
  await sql`INSERT INTO users (id, email, name) VALUES (${userId}, ${`${userId}@mb.local`}, 'MB') ON CONFLICT DO NOTHING`;
  await sql`
    INSERT INTO organizations (id, name, slug, tier, owner_user_id)
    VALUES (${id}, ${id}, ${id}, ${tier}, ${userId})
    ON CONFLICT (id) DO UPDATE SET tier = EXCLUDED.tier
  `;
}

async function seedRun(orgId: string, mode: string, opts: { old?: boolean } = {}) {
  if (opts.old) {
    await sql`
      INSERT INTO portal_run_logs (vendor_key, mode, status, organization_id, finished_at)
      VALUES (${`v-${SUFFIX}`}, ${mode}, 'success', ${orgId}, '2020-01-15 10:00:00+00')`;
  } else {
    await sql`
      INSERT INTO portal_run_logs (vendor_key, mode, status, organization_id, finished_at)
      VALUES (${`v-${SUFFIX}`}, ${mode}, 'success', ${orgId}, NOW()::TEXT)`;
  }
}

async function cleanup() {
  await sql`DELETE FROM portal_run_logs WHERE organization_id = ANY(${ALL}::text[])`;
  await sql`DELETE FROM organizations WHERE id = ANY(${ALL}::text[])`;
  await sql`DELETE FROM users WHERE id = ANY(${ALL.map((o) => `u-${o}`)}::text[])`;
}

describe.skipIf(!hasDb)("portal mistral recording budget (INFETCH-149)", () => {
  beforeEach(async () => {
    await cleanup();
    await seedOrg(ORG_FREE, "free");
    await seedOrg(ORG_PRO, "pro");
    await seedOrg(ORG_BIZ, "business");
  });
  afterEach(cleanup);

  it("Budget-Limits pro Tier: Free 0 / Pro 10 / Business 40", async () => {
    expect((await canRecordPortalRecipe(ORG_FREE)).max).toBe(0);
    expect((await canRecordPortalRecipe(ORG_PRO)).max).toBe(10);
    expect((await canRecordPortalRecipe(ORG_BIZ)).max).toBe(40);
  });

  it("Free darf nie aufnehmen (max 0)", async () => {
    expect((await canRecordPortalRecipe(ORG_FREE)).allowed).toBe(false);
  });

  it("Pro: unter Budget erlaubt, am Budget gesperrt", async () => {
    expect((await canRecordPortalRecipe(ORG_PRO)).allowed).toBe(true);
    for (let i = 0; i < 10; i++) await seedRun(ORG_PRO, "record");
    const atLimit = await canRecordPortalRecipe(ORG_PRO);
    expect(atLimit.current).toBe(10);
    expect(atLimit.allowed).toBe(false);
  });

  it("Zählt nur Recording-Modi des laufenden Monats der eigenen Org", async () => {
    await seedRun(ORG_PRO, "record");
    await seedRun(ORG_PRO, "replay_then_record");
    await seedRun(ORG_PRO, "replay"); // kein Recording → zählt nicht
    await seedRun(ORG_PRO, "record", { old: true }); // Vormonat → zählt nicht
    await seedRun(ORG_BIZ, "record"); // andere Org → zählt nicht
    expect(await getMonthlyPortalRecordingCount(ORG_PRO)).toBe(2);
  });
});
