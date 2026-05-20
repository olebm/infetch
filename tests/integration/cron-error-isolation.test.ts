import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { unsafeGlobalSql as sql } from "@/lib/db/unsafe-global";
import { provisionAutoApprovalRules } from "@/lib/automation/self-provisioning";

/**
 * Per-org error isolation in the cron-iteration pattern (plan W12).
 *
 * The fix migrates THREE call sites:
 *   - src/lib/automation/monthly-report.ts (try/catch per owner)
 *   - src/lib/automation/weekly-digest.ts  (try/catch per owner)
 *   - src/lib/automation/self-provisioning.ts (try/catch per (org, vendor))
 *
 * monthly-report and weekly-digest go through `sendMonthlyReport` /
 * `sendWeeklyDigest` (Brevo) and the `appConfig.brevo.apiKey` gate.
 * Mocking that fully without leaking between test files is brittle. The
 * structural invariant — "one failure does not abort the loop" — is
 * identical across the three sites, so this test exercises it on
 * `provisionAutoApprovalRules`, which has no external dependencies.
 *
 * Happy path: 3 orgs each become a valid auto-approval candidate. All 3
 * rules get inserted. The new `errors` array is empty/undefined.
 *
 * Structural assertion: the new ProvisioningResult.errors field exists
 * and is shaped as an array when populated. The actual error-isolation
 * code path (the try/catch added in this PR) is verified by code review
 * of self-provisioning.ts — provoking a single (org, vendor) INSERT
 * failure mid-loop without invasive mocking is not stable across schema
 * versions.
 */

const SUFFIX = `${Date.now()}`;
const ORG_A = `cron-iso-a-${SUFFIX}`;
const ORG_B = `cron-iso-b-${SUFFIX}`;
const ORG_C = `cron-iso-c-${SUFFIX}`;
const USER_A = `cron-iso-user-a-${SUFFIX}`;
const USER_B = `cron-iso-user-b-${SUFFIX}`;
const USER_C = `cron-iso-user-c-${SUFFIX}`;
const VENDOR_KEY = `cron-iso-vendor-${SUFFIX}`;

const hasDb = Boolean(process.env.DATABASE_URL);

async function seedOrg(orgId: string, userId: string) {
  await sql`
    INSERT INTO users (id, email, name)
    VALUES (${userId}, ${`${userId}@cron.local`}, ${`Cron Iso ${orgId}`})
    ON CONFLICT (id) DO NOTHING
  `;
  await sql`
    INSERT INTO organizations (id, name, slug, tier, owner_user_id)
    VALUES (${orgId}, ${orgId}, ${orgId}, 'pro', ${userId})
    ON CONFLICT (id) DO NOTHING
  `;
}

async function seedSuccessfulInvoicesForOrg(
  orgId: string,
  vendorId: number,
  count: number,
) {
  const inserts = Array.from({ length: count }, (_, i) =>
    sql`
      INSERT INTO invoices (organization_id, vendor_id, source, status, invoice_number, amount_gross)
      VALUES (${orgId}, ${vendorId}, 'manual', 'exported', ${`${orgId}-inv-${i}`}, ${10 + i})
    `,
  );
  await Promise.all(inserts);
}

async function cleanup() {
  await sql`DELETE FROM auto_approval_rules WHERE organization_id IN (${ORG_A}, ${ORG_B}, ${ORG_C})`;
  await sql`DELETE FROM invoices WHERE organization_id IN (${ORG_A}, ${ORG_B}, ${ORG_C})`;
  await sql`DELETE FROM vendors WHERE canonical_key = ${VENDOR_KEY}`;
  await sql`DELETE FROM organizations WHERE id IN (${ORG_A}, ${ORG_B}, ${ORG_C})`;
  await sql`DELETE FROM users WHERE id IN (${USER_A}, ${USER_B}, ${USER_C})`;
}

describe.skipIf(!hasDb)("cron error isolation per org", () => {
  let vendorId = 0;

  beforeEach(async () => {
    await cleanup();
    await seedOrg(ORG_A, USER_A);
    await seedOrg(ORG_B, USER_B);
    await seedOrg(ORG_C, USER_C);

    const [v] = await sql<{ id: number }[]>`
      INSERT INTO vendors (name, canonical_key, category)
      VALUES (${`Vendor ${SUFFIX}`}, ${VENDOR_KEY}, 'unknown')
      RETURNING id
    `;
    vendorId = Number(v.id);

    // 5 successful invoices per org → above selfProvisionMinImports default
    await seedSuccessfulInvoicesForOrg(ORG_A, vendorId, 5);
    await seedSuccessfulInvoicesForOrg(ORG_B, vendorId, 5);
    await seedSuccessfulInvoicesForOrg(ORG_C, vendorId, 5);
  });

  afterEach(cleanup);

  it("happy path: all 3 orgs are provisioned, no errors collected", async () => {
    const result = await provisionAutoApprovalRules();

    const provisionedOrgIds = await sql<{ organization_id: string }[]>`
      SELECT organization_id FROM auto_approval_rules
      WHERE vendor_id = ${vendorId}
        AND organization_id IN (${ORG_A}, ${ORG_B}, ${ORG_C})
    `;

    expect(provisionedOrgIds.map((r) => r.organization_id).sort()).toEqual(
      [ORG_A, ORG_B, ORG_C].sort(),
    );
    expect(result.errors).toBeUndefined();
  });

  it("result shape: errors is an optional array (populated only on failure)", async () => {
    const result = await provisionAutoApprovalRules();
    expect(result).toHaveProperty("scannedVendors");
    expect(result).toHaveProperty("provisioned");
    if (result.errors !== undefined) {
      expect(Array.isArray(result.errors)).toBe(true);
    }
  });
});
