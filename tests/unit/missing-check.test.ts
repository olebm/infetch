import { format } from "date-fns";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { sql } from "@/lib/db/client";
import { runMissingInvoiceCheck } from "@/invoices/missing-check";

// NOTE: runMissingInvoiceCheck is org-scoped since migration 0019 — it iterates
// organizations and writes vendor_month_status with a NOT NULL organization_id
// (FK vendor_month_status_organization_id_fkey). The test therefore owns its own
// organization and scopes all assertions to it.

const TEST_ORG_ID = `org-missing-test-${Date.now()}`;
const TEST_USER_ID = `user-missing-test-${Date.now()}`;

async function getVendorId(canonicalKey: string): Promise<number> {
  const rows = await sql<
    { id: number }[]
  >`SELECT id FROM vendors WHERE canonical_key = ${canonicalKey}`;
  if (!rows[0]) throw new Error(`vendor ${canonicalKey} not found`);
  return rows[0].id;
}

async function setupOrg() {
  await sql`
    INSERT INTO users (id, email, name)
    VALUES (${TEST_USER_ID}, ${`missing-test-${Date.now()}@infetch.local`}, 'Missing Test')
    ON CONFLICT DO NOTHING
  `;
  await sql`
    INSERT INTO organizations (id, name, slug, tier, owner_user_id)
    VALUES (${TEST_ORG_ID}, 'Missing Test Org', ${`missing-test-${Date.now()}`}, 'pro', ${TEST_USER_ID})
    ON CONFLICT DO NOTHING
  `;
}

async function cleanup() {
  await sql`DELETE FROM vendor_month_status WHERE organization_id = ${TEST_ORG_ID}`;
  await sql`DELETE FROM invoices WHERE organization_id = ${TEST_ORG_ID}`;
  await sql`DELETE FROM organizations WHERE id = ${TEST_ORG_ID}`;
  await sql`DELETE FROM users WHERE id = ${TEST_USER_ID}`;
}

describe("missing invoice check", () => {
  beforeEach(async () => {
    await cleanup();
    await setupOrg();
  });
  afterEach(cleanup);

  it("marks manual invoices as found and missing months as portal required", async () => {
    const openAiId = await getVendorId("openai");
    const currentMonth = format(new Date(), "yyyy-MM");

    // Insert a manual invoice for the current month, owned by the test org
    await sql`
      INSERT INTO invoices (organization_id, vendor_id, source, status, invoice_date, confidence, dedupe_key)
      VALUES (${TEST_ORG_ID}, ${openAiId}, 'manual', 'ready', ${currentMonth + "-01"}, 0.9, ${"manual-hash-" + Date.now()})
    `;

    const result = await runMissingInvoiceCheck();

    const openAiRows = await sql<
      { manualStatus: string; finalStatus: string; sourceUsed: string }[]
    >`
      SELECT manual_status AS "manualStatus", final_status AS "finalStatus", source_used AS "sourceUsed"
      FROM vendor_month_status
      WHERE organization_id = ${TEST_ORG_ID} AND vendor_id = ${openAiId} AND year_month = ${currentMonth}
    `;
    const requiredRows = await sql<{ count: string }[]>`
      SELECT COUNT(*) AS count FROM vendor_month_status
      WHERE organization_id = ${TEST_ORG_ID} AND portal_status = 'required'
    `;
    const syncRunRows = await sql<{ status: string }[]>`
      SELECT status FROM sync_runs WHERE id = ${result.syncRunId}
    `;

    expect(openAiRows[0]).toEqual({
      manualStatus: "imported",
      finalStatus: "found",
      sourceUsed: "manual",
    });
    expect(Number(requiredRows[0].count)).toBeGreaterThan(0);
    expect(syncRunRows[0].status).toBe("succeeded");
    // DB-schwerer Integrationstest (~4-5s) — höheres Timeout, damit er unter
    // voller Suite-Last nicht am 5s-Default flaket (Gate-Hygiene, vorbestehend).
  }, 15000);
});
