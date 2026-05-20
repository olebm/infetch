import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { unsafeGlobalSql as sql } from "@/lib/db/unsafe-global";

// Mock the mail send so we can simulate per-org failures without hitting Brevo.
vi.mock("@/lib/mail/notify", () => ({
  sendWeeklyDigest: vi.fn(),
  sendMonthlyReport: vi.fn(),
}));

// appConfig.brevo.apiKey must be set so the runners don't short-circuit
// the early "skipped: no BREVO_API_KEY" branch.
vi.mock("@/lib/config/env", async () => {
  const actual: typeof import("@/lib/config/env") = await vi.importActual(
    "@/lib/config/env",
  );
  return {
    ...actual,
    appConfig: {
      ...actual.appConfig,
      brevo: { ...actual.appConfig.brevo, apiKey: "test-mock-key" },
    },
  };
});

import { runWeeklyDigest } from "@/lib/automation/weekly-digest";
import { runMonthlyReport } from "@/lib/automation/monthly-report";
import { sendWeeklyDigest, sendMonthlyReport } from "@/lib/mail/notify";

const SUFFIX = `${Date.now()}`;
const ORG_A = `cron-iso-a-${SUFFIX}`;
const ORG_B = `cron-iso-b-${SUFFIX}`;
const ORG_C = `cron-iso-c-${SUFFIX}`;
const USER_A = `cron-iso-user-a-${SUFFIX}`;
const USER_B = `cron-iso-user-b-${SUFFIX}`;
const USER_C = `cron-iso-user-c-${SUFFIX}`;
const EMAIL_A = `${USER_A}@cron.local`;
const EMAIL_B = `${USER_B}@cron.local`;
const EMAIL_C = `${USER_C}@cron.local`;

const hasDb = Boolean(process.env.DATABASE_URL);

async function seedOrg(orgId: string, userId: string, email: string) {
  await sql`
    INSERT INTO users (id, email, name)
    VALUES (${userId}, ${email}, ${`Cron Iso ${orgId}`})
    ON CONFLICT (id) DO NOTHING
  `;
  await sql`
    INSERT INTO organizations (id, name, slug, tier, owner_user_id)
    VALUES (${orgId}, ${orgId}, ${orgId}, 'pro', ${userId})
    ON CONFLICT (id) DO NOTHING
  `;
}

async function cleanup() {
  await sql`DELETE FROM organizations WHERE id IN (${ORG_A}, ${ORG_B}, ${ORG_C})`;
  await sql`DELETE FROM users WHERE id IN (${USER_A}, ${USER_B}, ${USER_C})`;
}

describe.skipIf(!hasDb)("cron error isolation per org", () => {
  beforeEach(async () => {
    await cleanup();
    await seedOrg(ORG_A, USER_A, EMAIL_A);
    await seedOrg(ORG_B, USER_B, EMAIL_B);
    await seedOrg(ORG_C, USER_C, EMAIL_C);
    vi.mocked(sendWeeklyDigest).mockReset();
    vi.mocked(sendMonthlyReport).mockReset();
  });

  afterEach(cleanup);

  it("runWeeklyDigest: one org throws, other orgs still get processed", async () => {
    vi.mocked(sendWeeklyDigest).mockImplementation(async (opts) => {
      if (opts.to === EMAIL_B) throw new Error("brevo 500 for org B");
      return true;
    });

    const { results } = await runWeeklyDigest();

    const ourResults = results.filter((r) =>
      [EMAIL_A, EMAIL_B, EMAIL_C].includes(r.email),
    );
    expect(ourResults).toHaveLength(3);

    const a = ourResults.find((r) => r.email === EMAIL_A);
    const b = ourResults.find((r) => r.email === EMAIL_B);
    const c = ourResults.find((r) => r.email === EMAIL_C);

    expect(a?.sent).toBe(true);
    expect(a?.error).toBeUndefined();
    expect(b?.sent).toBe(false);
    expect(b?.error).toMatch(/brevo 500 for org B/);
    expect(c?.sent).toBe(true);
    expect(c?.error).toBeUndefined();
  });

  it("runMonthlyReport: one org throws, other orgs still get processed", async () => {
    // Seed each org with at least one 'exported' invoice for the previous
    // month, otherwise the per-org "nothing to report" early-return fires
    // and sendMonthlyReport is never called.
    const now = new Date();
    const prevMonth = new Date(now.getFullYear(), now.getMonth() - 1, 15)
      .toISOString()
      .slice(0, 10); // e.g. "2026-04-15"
    for (const org of [ORG_A, ORG_B, ORG_C]) {
      await sql`
        INSERT INTO invoices (vendor_id, source, status, invoice_number, invoice_date, organization_id)
        VALUES (NULL, 'manual', 'exported', ${`cron-iso-${org}-${SUFFIX}`}, ${prevMonth}, ${org})
      `;
    }

    vi.mocked(sendMonthlyReport).mockImplementation(async (opts) => {
      if (opts.to === EMAIL_B) throw new Error("brevo 503 for org B");
      return true;
    });

    const { results } = await runMonthlyReport();

    const ourResults = results.filter((r) =>
      [EMAIL_A, EMAIL_B, EMAIL_C].includes(r.email),
    );
    expect(ourResults).toHaveLength(3);

    const a = ourResults.find((r) => r.email === EMAIL_A);
    const b = ourResults.find((r) => r.email === EMAIL_B);
    const c = ourResults.find((r) => r.email === EMAIL_C);

    expect(a?.sent).toBe(true);
    expect(b?.sent).toBe(false);
    expect(b?.error).toMatch(/brevo 503 for org B/);
    expect(c?.sent).toBe(true);

    // Cleanup the seeded invoices (afterEach handles orgs/users via cleanup()).
    await sql`DELETE FROM invoices WHERE organization_id IN (${ORG_A}, ${ORG_B}, ${ORG_C})`;
  });
});
