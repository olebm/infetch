import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Mock Supabase Storage like the import-pipeline test does — keeps the
// test hermetic (CI has no real Supabase bucket).
const storageStore = new Map<string, Buffer>();
vi.mock("@/lib/supabase/server", () => ({
  createSupabaseAdminClient: () => ({
    storage: {
      from: (bucket: string) => ({
        async upload(key: string, body: Buffer) {
          storageStore.set(`${bucket}/${key}`, Buffer.from(body));
          return { error: null };
        },
        async download(key: string) {
          const buf = storageStore.get(`${bucket}/${key}`);
          if (!buf) return { data: null, error: { message: "not found" } };
          return { data: new Blob([new Uint8Array(buf)]), error: null };
        },
        async remove(keys: string[]) {
          for (const k of keys) storageStore.delete(`${bucket}/${k}`);
          return { error: null };
        },
      }),
    },
  }),
}));

// Force Pro-enabled = true so the tier lookup returns the org's declared tier
// instead of the global free-tier-Klemme (see appConfig.billing.proEnabled).
const ORIGINAL_PRO_ENABLED = process.env.NEXT_PUBLIC_PRO_ENABLED;
process.env.NEXT_PUBLIC_PRO_ENABLED = "true";

import { unsafeGlobalSql as sql } from "@/lib/db/unsafe-global";
import { importPdfBuffer } from "@/invoices/import-pipeline";
import { TIER_LIMITS } from "@/lib/tier";

const SUFFIX = `${Date.now()}`;
const ORG_ID = `toctou-${SUFFIX}`;
const USER_ID = `toctou-user-${SUFFIX}`;
const MAX_FREE = TIER_LIMITS.free.maxInvoicesPerMonth;

const hasDb = Boolean(process.env.DATABASE_URL);

function makePdfBuffer(content: string): Buffer {
  // Minimal valid PDF header + EOF — same shape import-pipeline.test.ts uses.
  return Buffer.from(`%PDF-1.4\n1 0 obj\n<< /Type /Catalog >>\nendobj\n${content}\n%%EOF`);
}

async function seedFreeOrg() {
  await sql`
    INSERT INTO users (id, email, name)
    VALUES (${USER_ID}, ${`${USER_ID}@toctou.local`}, 'TOCTOU Test')
    ON CONFLICT (id) DO NOTHING
  `;
  await sql`
    INSERT INTO organizations (id, name, slug, tier, owner_user_id)
    VALUES (${ORG_ID}, ${ORG_ID}, ${ORG_ID}, 'free', ${USER_ID})
    ON CONFLICT (id) DO NOTHING
  `;
}

async function seedInvoicesAtBoundary(count: number) {
  // Raw inserts bypass the importPdfBuffer pipeline. created_at uses NOW()
  // so each row counts toward the current month for canImportInvoice.
  const rows = Array.from({ length: count }, (_, i) =>
    sql`
      INSERT INTO invoices (vendor_id, source, status, invoice_number, organization_id)
      VALUES (NULL, 'manual', 'ready', ${`toctou-seed-${SUFFIX}-${i}`}, ${ORG_ID})
    `,
  );
  await Promise.all(rows);
}

async function cleanup() {
  await sql`DELETE FROM invoice_files WHERE organization_id = ${ORG_ID}`;
  await sql`DELETE FROM invoices WHERE organization_id = ${ORG_ID}`;
  await sql`DELETE FROM organizations WHERE id = ${ORG_ID}`;
  await sql`DELETE FROM users WHERE id = ${USER_ID}`;
}

describe.skipIf(!hasDb)("quota TOCTOU prevention (in-tx recheck)", () => {
  beforeEach(async () => {
    await cleanup();
    await seedFreeOrg();
  });

  afterEach(async () => {
    await cleanup();
  });

  it("rejects an import that crosses the limit even when seeded ONE BELOW", async () => {
    // Seed at limit - 1: a single import should still succeed (in-tx recheck
    // sees count = MAX-1 < MAX → passes), and a SECOND concurrent import
    // must fail (in-tx recheck after T1 commits sees count = MAX, fails).
    await seedInvoicesAtBoundary(MAX_FREE - 1);

    const buf1 = makePdfBuffer(`toctou-A-${SUFFIX}-${Math.random()}`);
    const buf2 = makePdfBuffer(`toctou-B-${SUFFIX}-${Math.random()}`);

    // Parallel imports — only ONE may win because of FOR UPDATE on the
    // organizations row + in-tx COUNT recheck.
    const [r1, r2] = await Promise.all([
      importPdfBuffer({
        buffer: buf1,
        originalFilename: "toctou-A.pdf",
        sourceType: "manual",
        organizationId: ORG_ID,
        bypassQuota: false,
      }),
      importPdfBuffer({
        buffer: buf2,
        originalFilename: "toctou-B.pdf",
        sourceType: "manual",
        organizationId: ORG_ID,
        bypassQuota: false,
      }),
    ]);

    const successes = [r1, r2].filter((r) => r.ok && r.status === "imported");
    const quotaFails = [r1, r2].filter(
      (r) => !r.ok && r.status === "quota_exceeded",
    );

    // Exactly one wins, exactly one is rejected. Without the in-tx recheck,
    // both would pass the pre-check (current = MAX-1) and both insert,
    // landing the org at MAX+1 — that's the regression this PR prevents.
    expect(successes).toHaveLength(1);
    expect(quotaFails).toHaveLength(1);

    // Final count must be exactly MAX — no overshoot.
    const [{ count }] = await sql<{ count: string }[]>`
      SELECT COUNT(*)::text AS count FROM invoices
      WHERE organization_id = ${ORG_ID}
        AND created_at >= TO_CHAR(DATE_TRUNC('month', NOW()), 'YYYY-MM-DD')
    `;
    expect(Number(count)).toBe(MAX_FREE);
  }, 15000);
});

// Restore env after this file finishes (vitest runs files in isolation
// per worker, but reset is good hygiene).
if (ORIGINAL_PRO_ENABLED === undefined) {
  delete process.env.NEXT_PUBLIC_PRO_ENABLED;
} else {
  process.env.NEXT_PUBLIC_PRO_ENABLED = ORIGINAL_PRO_ENABLED;
}
