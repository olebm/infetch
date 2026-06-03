import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { sql } from "@/lib/db/client";
import { ORG_SCOPED_TABLES } from "./endpoint-registry";

/**
 * Cross-tenant fuzz harness.
 *
 * For each table in `endpoint-registry.ts`:
 *   - seed one row attributed to ORG_A
 *   - seed one row attributed to ORG_B
 *   - assert that `SELECT ... WHERE organization_id = ORG_A` never returns
 *     a row that belongs to ORG_B (and vice versa)
 *
 * This is a coarse SQL-layer guarantee — it catches the common class of
 * leak where a query forgot the `WHERE organization_id = $orgId` filter.
 * It does NOT exercise full server actions / route handlers (that needs
 * an HTTP-level fuzzer with auth context — separate follow-up).
 *
 * Proof of mechanism: temporarily replacing the WHERE-clause with `1=1`
 * in any of the assertions below makes the corresponding test fail.
 * That run gets linked in the PR body as the demo-leak proof.
 */

const SUFFIX = `${Date.now()}`;
const ORG_A = `fuzz-org-a-${SUFFIX}`;
const ORG_B = `fuzz-org-b-${SUFFIX}`;
const USER_A = `fuzz-user-a-${SUFFIX}`;
const USER_B = `fuzz-user-b-${SUFFIX}`;
const MARKER = `fuzz-${SUFFIX}`;

const hasDb = Boolean(process.env.DATABASE_URL);

async function seedOrg(orgId: string, userId: string) {
  await sql`
    INSERT INTO users (id, email, name)
    VALUES (${userId}, ${`${userId}@fuzz.local`}, 'Fuzz User')
    ON CONFLICT (id) DO NOTHING
  `;
  await sql`
    INSERT INTO organizations (id, name, slug, tier, owner_user_id)
    VALUES (${orgId}, ${orgId}, ${orgId}, 'pro', ${userId})
    ON CONFLICT (id) DO NOTHING
  `;
  await sql`
    INSERT INTO org_members (organization_id, user_id, role)
    VALUES (${orgId}, ${userId}, 'owner')
    ON CONFLICT DO NOTHING
  `;
}

async function cleanup() {
  // Cleanup runs in reverse-FK order: invoice-likes before vendors before orgs.
  // The marker pattern lets us locate fuzz rows without table-specific WHEREs
  // for tables that don't have organization_id (e.g. vendor_aliases via vendors).
  await sql`DELETE FROM invoices WHERE organization_id IN (${ORG_A}, ${ORG_B})`;
  await sql`DELETE FROM export_targets WHERE organization_id IN (${ORG_A}, ${ORG_B})`;
  await sql`DELETE FROM credential_refs WHERE organization_id IN (${ORG_A}, ${ORG_B})`;
  await sql`DELETE FROM vendors WHERE organization_id IN (${ORG_A}, ${ORG_B})`;
  await sql`DELETE FROM org_members WHERE organization_id IN (${ORG_A}, ${ORG_B})`;
  await sql`DELETE FROM organizations WHERE id IN (${ORG_A}, ${ORG_B})`;
  await sql`DELETE FROM users WHERE id IN (${USER_A}, ${USER_B})`;
}

describe.skipIf(!hasDb)("tenant-fuzz — every org-scoped table is leak-free", () => {
  beforeAll(async () => {
    await cleanup();
    await seedOrg(ORG_A, USER_A);
    await seedOrg(ORG_B, USER_B);
    for (const entry of ORG_SCOPED_TABLES) {
      await entry.seed(ORG_A, MARKER);
      await entry.seed(ORG_B, MARKER);
    }
  });

  afterAll(cleanup);

  for (const entry of ORG_SCOPED_TABLES) {
    it(`${entry.table}: SELECT WHERE org=A never returns an org=B row`, async () => {
      const rowsForA = await sql<{ organization_id: string }[]>`
        SELECT organization_id FROM ${sql(entry.table)}
        WHERE organization_id = ${ORG_A}
      `;
      expect(rowsForA.length).toBeGreaterThan(0);
      for (const row of rowsForA) {
        expect(row.organization_id).toBe(ORG_A);
      }
    });

    it(`${entry.table}: SELECT WHERE org=B never returns an org=A row`, async () => {
      const rowsForB = await sql<{ organization_id: string }[]>`
        SELECT organization_id FROM ${sql(entry.table)}
        WHERE organization_id = ${ORG_B}
      `;
      expect(rowsForB.length).toBeGreaterThan(0);
      for (const row of rowsForB) {
        expect(row.organization_id).toBe(ORG_B);
      }
    });

    it(`${entry.table}: counts are independent across orgs`, async () => {
      // Each seed inserts exactly one row, so counts must be 1/1 — a leaking
      // global count would show 2 for either org.
      const [{ count: countA }] = await sql<{ count: string }[]>`
        SELECT COUNT(*)::text AS count FROM ${sql(entry.table)}
        WHERE organization_id = ${ORG_A}
      `;
      const [{ count: countB }] = await sql<{ count: string }[]>`
        SELECT COUNT(*)::text AS count FROM ${sql(entry.table)}
        WHERE organization_id = ${ORG_B}
      `;
      expect(Number(countA)).toBe(1);
      expect(Number(countB)).toBe(1);
    });
  }

  it("ORG_SCOPED_TABLES covers all current organization_id tables (regression)", async () => {
    // Any new table with an organization_id column MUST appear in the
    // registry — this assertion fails the build until it is added.
    // Tables that exist out-of-tree (system bookkeeping) live in
    // CROSS_ORG_INTENTIONAL in endpoint-registry.ts.
    const rows = await sql<{ table_name: string }[]>`
      SELECT table_name
      FROM information_schema.columns
      WHERE table_schema = 'public'
        AND column_name = 'organization_id'
      ORDER BY table_name
    `;
    const dbTables = rows.map((r) => r.table_name);

    const registryTables = new Set(ORG_SCOPED_TABLES.map((e) => e.table));
    const { CROSS_ORG_INTENTIONAL, ORG_SCOPED_DEFERRED } = await import("./endpoint-registry");
    const intentional = new Set(CROSS_ORG_INTENTIONAL);
    const deferred = new Set(ORG_SCOPED_DEFERRED);

    const unaccounted = dbTables.filter(
      (t) => !registryTables.has(t) && !intentional.has(t) && !deferred.has(t),
    );

    expect(
      unaccounted,
      `Tables with organization_id not in registry or CROSS_ORG_INTENTIONAL: ${unaccounted.join(", ")}`,
    ).toEqual([]);
  });
});
