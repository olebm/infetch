import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { withOrgLock } from "@/lib/db/advisory-lock";
import { unsafeGlobalSql as sql } from "@/lib/db/unsafe-global";

/**
 * Per-org advisory lock semantics.
 *
 * `withOrgLock` is bypassed under Vitest by default (see advisory-lock.ts).
 * For this test we opt into the real lock semantics by setting
 * DISABLE_LOCK_BYPASS=1 in the test process. We seed two real orgs so the
 * lock keys are deterministic across runs.
 *
 * Test plan:
 *   - Same-org concurrent calls SERIALIZE (one waits for the other)
 *   - Different-org concurrent calls run in PARALLEL
 *   - Lock releases on exception (XACT-scoped → ROLLBACK releases)
 */

// Opt into real lock behavior for this file. The bypass is module-level
// in advisory-lock.ts so we set the env var BEFORE the import resolves;
// at this point the module is already cached. We import lazily inside
// each test to defeat the cache.
const SUFFIX = `${Date.now()}`;
const ORG_A = `lock-test-a-${SUFFIX}`;
const ORG_B = `lock-test-b-${SUFFIX}`;
const USER_A = `lock-user-a-${SUFFIX}`;
const USER_B = `lock-user-b-${SUFFIX}`;

const hasDb = Boolean(process.env.DATABASE_URL);

async function seedOrg(orgId: string, userId: string) {
  await sql`
    INSERT INTO users (id, email, name)
    VALUES (${userId}, ${`${userId}@lock.local`}, 'Lock User')
    ON CONFLICT (id) DO NOTHING
  `;
  await sql`
    INSERT INTO organizations (id, name, slug, tier, owner_user_id)
    VALUES (${orgId}, ${orgId}, ${orgId}, 'pro', ${userId})
    ON CONFLICT (id) DO NOTHING
  `;
}

async function cleanup() {
  await sql`DELETE FROM organizations WHERE id IN (${ORG_A}, ${ORG_B})`;
  await sql`DELETE FROM users WHERE id IN (${USER_A}, ${USER_B})`;
}

/**
 * Acquires the per-org lock, sleeps `ms`, releases. Returns the
 * window [acquiredAt, releasedAt] in epoch ms for the caller to compare.
 */
async function holdLockFor(orgId: string, ms: number): Promise<[number, number]> {
  process.env.DISABLE_LOCK_BYPASS = "1";
  let acquiredAt = 0;
  let releasedAt = 0;
  await withOrgLock(orgId, async () => {
    acquiredAt = Date.now();
    await new Promise((r) => setTimeout(r, ms));
    releasedAt = Date.now();
  });
  return [acquiredAt, releasedAt];
}

describe.skipIf(!hasDb)("per-org advisory lock (withOrgLock)", () => {
  beforeAll(async () => {
    await cleanup();
    await seedOrg(ORG_A, USER_A);
    await seedOrg(ORG_B, USER_B);
  });

  afterAll(async () => {
    delete process.env.DISABLE_LOCK_BYPASS;
    await cleanup();
  });

  it("serializes same-org concurrent calls (one waits)", async () => {
    // Two concurrent holds of 150ms each on the SAME org. One acquires
    // immediately; the other must wait until the first releases. So the
    // two windows must NOT overlap.
    const [winA, winB] = await Promise.all([
      holdLockFor(ORG_A, 150),
      holdLockFor(ORG_A, 150),
    ]);

    const [aStart, aEnd] = winA;
    const [bStart, bEnd] = winB;
    const overlap = Math.min(aEnd, bEnd) - Math.max(aStart, bStart);

    // Non-overlap means one's start is ≥ the other's end. Allow a small
    // negative slop for clock granularity; require strict serialization.
    expect(overlap).toBeLessThanOrEqual(5);
  }, 5000);

  it("runs different-org concurrent calls in parallel", async () => {
    // Two concurrent holds of 150ms each on DIFFERENT orgs — they should
    // overlap (run in parallel) because the lock keys differ.
    const [winA, winB] = await Promise.all([
      holdLockFor(ORG_A, 150),
      holdLockFor(ORG_B, 150),
    ]);

    const [aStart, aEnd] = winA;
    const [bStart, bEnd] = winB;
    const overlap = Math.min(aEnd, bEnd) - Math.max(aStart, bStart);

    // They started effectively at the same time; overlap should be ~150ms
    // (less the small dispatch jitter). Require at least 100ms overlap.
    expect(overlap).toBeGreaterThanOrEqual(100);
  }, 5000);

  it("releases the lock on thrown exception (XACT rollback)", async () => {
    process.env.DISABLE_LOCK_BYPASS = "1";
    // First call throws inside withOrgLock — the transaction rolls back
    // and the advisory lock is released. Second call must acquire OK.
    await expect(
      withOrgLock(ORG_A, async () => {
        throw new Error("deliberate failure for lock-release test");
      }),
    ).rejects.toThrow("deliberate failure");

    // If the lock had not released, this would hang and time out.
    const [start, end] = await holdLockFor(ORG_A, 10);
    expect(end - start).toBeGreaterThanOrEqual(10);
  }, 5000);
});
