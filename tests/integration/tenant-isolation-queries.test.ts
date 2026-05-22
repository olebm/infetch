import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { sql } from "@/lib/db/client";
import {
  getMissingItems,
  getMissingMatrix,
  getPipelineSnapshot,
  getVendors,
  getAutomationStats,
  getMonthlyKpis,
  getDailyTimeseries,
  getObservationStartDate,
  getLastScanAt,
  getPrimaryMailAccount,
  getSecondaryMailAccount,
} from "@/lib/db/queries";

// Regressionstest für Mandanten-Isolation der Lieferanten-/Missing-Queries.
// Der App-Pfad nutzt den service_role-Client und umgeht RLS — die Trennung
// hängt am organization_id-Filter im Query-Code. Dieser Test fixiert den
// Kontrakt: Org A darf org-eigene Vendoren bzw. den Missing-Status-Cache von
// Org B niemals sehen.

const SUFFIX = `${Date.now()}`;
const ORG_A = `org-a-vq-${SUFFIX}`;
const ORG_B = `org-b-vq-${SUFFIX}`;
const USER_A = `user-a-vq-${SUFFIX}`;
const USER_B = `user-b-vq-${SUFFIX}`;
const KEY_A = `vendor-a-vq-${SUFFIX}`;
const KEY_B = `vendor-b-vq-${SUFFIX}`;
const YM = "2099-01"; // außerhalb jedes realen Fensters, kollidiert mit nichts

const hasDb = Boolean(process.env.DATABASE_URL);

async function seedOrgWithVendor(orgId: string, userId: string, key: string): Promise<number> {
  await sql`INSERT INTO users (id, email, name) VALUES (${userId}, ${`${userId}@iso.local`}, 'Iso') ON CONFLICT DO NOTHING`;
  await sql`
    INSERT INTO organizations (id, name, slug, tier, owner_user_id)
    VALUES (${orgId}, ${orgId}, ${orgId}, 'pro', ${userId})
    ON CONFLICT DO NOTHING
  `;
  const [vendor] = await sql<{ id: number }[]>`
    INSERT INTO vendors (name, canonical_key, category, organization_id)
    VALUES (${`Vendor ${key}`}, ${key}, 'unknown', ${orgId})
    RETURNING id
  `;
  await sql`
    INSERT INTO vendor_month_status
      (vendor_id, year_month, mail_status, portal_status, manual_status, final_status, source_used, organization_id)
    VALUES
      (${vendor.id}, ${YM}, 'missing', 'not_needed', 'none', 'missing', 'none', ${orgId})
  `;
  return Number(vendor.id);
}

async function cleanup() {
  await sql`DELETE FROM invoices WHERE organization_id IN (${ORG_A}, ${ORG_B})`;
  await sql`DELETE FROM vendor_month_status WHERE organization_id IN (${ORG_A}, ${ORG_B})`;
  await sql`DELETE FROM vendors WHERE canonical_key IN (${KEY_A}, ${KEY_B})`;
  await sql`DELETE FROM organizations WHERE id IN (${ORG_A}, ${ORG_B})`;
  await sql`DELETE FROM users WHERE id IN (${USER_A}, ${USER_B})`;
}

describe.skipIf(!hasDb)("tenant isolation — vendor & missing queries", () => {
  let vendorA = 0;
  let vendorB = 0;

  beforeEach(async () => {
    await cleanup();
    vendorA = await seedOrgWithVendor(ORG_A, USER_A, KEY_A);
    vendorB = await seedOrgWithVendor(ORG_B, USER_B, KEY_B);
  });
  afterEach(cleanup);

  it("getVendors: caller sees its own org vendor but not another org's", async () => {
    const idsA = (await getVendors(ORG_A)).map((v) => v.id);
    expect(idsA).toContain(vendorA);
    expect(idsA).not.toContain(vendorB);

    const idsB = (await getVendors(ORG_B)).map((v) => v.id);
    expect(idsB).toContain(vendorB);
    expect(idsB).not.toContain(vendorA);
  });

  it("getVendors: a null-org caller sees neither org's private vendor", async () => {
    const ids = (await getVendors(null)).map((v) => v.id);
    expect(ids).not.toContain(vendorA);
    expect(ids).not.toContain(vendorB);
  });

  it("getMissingItems: caller sees only its own org's missing status", async () => {
    const idsA = (await getMissingItems(ORG_A)).map((m) => m.vendorId);
    expect(idsA).toContain(vendorA);
    expect(idsA).not.toContain(vendorB);

    const idsB = (await getMissingItems(ORG_B)).map((m) => m.vendorId);
    expect(idsB).toContain(vendorB);
    expect(idsB).not.toContain(vendorA);
  });

  it("getMissingMatrix: caller's matrix never lists another org's vendor", async () => {
    const matrixA = await getMissingMatrix(ORG_A, true);
    const matrixIdsA = matrixA.map((r) => r.vendor.id);
    expect(matrixIdsA).toContain(vendorA);
    expect(matrixIdsA).not.toContain(vendorB);

    const matrixB = await getMissingMatrix(ORG_B, true);
    const matrixIdsB = matrixB.map((r) => r.vendor.id);
    expect(matrixIdsB).toContain(vendorB);
    expect(matrixIdsB).not.toContain(vendorA);
  });

  it("getPipelineSnapshot: needs_review count is org-scoped (regression for 1.3)", async () => {
    // Only ORG_B has an invoice in needs_review state. Pre-fix, the count
    // was global, so ORG_A would also see status="needs_review". Post-fix
    // it's org-scoped: ORG_A reports "pending", ORG_B reports "needs_review".
    await sql`
      INSERT INTO invoices (vendor_id, source, status, invoice_number, organization_id)
      VALUES (${vendorB}, 'manual', 'needs_review', ${`B-NEEDS-${SUFFIX}`}, ${ORG_B})
    `;

    const snapshotA = await getPipelineSnapshot(ORG_A);
    const snapshotB = await getPipelineSnapshot(ORG_B);

    const reviewA = snapshotA.find((s) => s.label === "Review");
    const reviewB = snapshotB.find((s) => s.label === "Review");

    expect(reviewA?.status).toBe("pending");
    expect(reviewB?.status).toBe("needs_review");
  });
});

// ─── Dashboard-Queries (diese Session org-gescopt) ───────────────────────────
// Regression gegen die Multi-Tenant-Leaks, die das Dashboard betrafen:
// getAutomationStats / getMonthlyKpis / getDailyTimeseries /
// getObservationStartDate / getLastScanAt / getPrimaryMailAccount /
// getSecondaryMailAccount. Org A darf nie Org-B-Zahlen/Mailbox sehen.

const D_ORG_A = `dash-a-${SUFFIX}`;
const D_ORG_B = `dash-b-${SUFFIX}`;
const D_USER_A = `dash-ua-${SUFFIX}`;
const D_USER_B = `dash-ub-${SUFFIX}`;
const TODAY = new Date().toISOString().slice(0, 10);
const MONTH = TODAY.slice(0, 7);

async function seedDashboardOrg(
  orgId: string,
  userId: string,
  tag: string,
  opts: { invoices: number; createdAt: string; scanAt: string },
) {
  await sql`INSERT INTO users (id, email, name) VALUES (${userId}, ${`${userId}@iso.local`}, 'Dash') ON CONFLICT DO NOTHING`;
  await sql`INSERT INTO organizations (id, name, slug, tier, owner_user_id) VALUES (${orgId}, ${orgId}, ${orgId}, 'pro', ${userId}) ON CONFLICT DO NOTHING`;
  for (let i = 0; i < opts.invoices; i++) {
    await sql`
      INSERT INTO invoices (organization_id, source, status, confidence, dedupe_key, invoice_date, amount_gross, created_at)
      VALUES (${orgId}, 'manual', 'exported', 0.9, ${`${tag}-inv-${i}-${SUFFIX}`}, ${TODAY}, 10, ${opts.createdAt})
    `;
  }
  await sql`INSERT INTO mail_accounts (label, host, port, secure, username, status, organization_id) VALUES ('Primary IMAP', 'imap.iso', 993, true, ${`primary-${tag}@iso.local`}, 'configured', ${orgId})`;
  await sql`INSERT INTO mail_accounts (label, host, port, secure, username, status, organization_id) VALUES ('Secondary IMAP', 'imap.iso', 993, true, ${`secondary-${tag}@iso.local`}, 'configured', ${orgId})`;
  await sql`INSERT INTO sync_runs (type, status, triggered_by, started_at, organization_id) VALUES ('imap_scan', 'succeeded', 'schedule', ${opts.scanAt}, ${orgId})`;
}

async function cleanupDashboard() {
  await sql`DELETE FROM sync_runs WHERE organization_id IN (${D_ORG_A}, ${D_ORG_B})`;
  await sql`DELETE FROM mail_accounts WHERE organization_id IN (${D_ORG_A}, ${D_ORG_B})`;
  await sql`DELETE FROM invoices WHERE organization_id IN (${D_ORG_A}, ${D_ORG_B})`;
  await sql`DELETE FROM organizations WHERE id IN (${D_ORG_A}, ${D_ORG_B})`;
  await sql`DELETE FROM users WHERE id IN (${D_USER_A}, ${D_USER_B})`;
}

describe.skipIf(!hasDb)("tenant isolation — dashboard queries", () => {
  beforeEach(async () => {
    await cleanupDashboard();
    // A: 2 exported (heute erstellt), Scan 2026-05-01.
    // B: 3 exported (created_at 2020 = alt), Scan 2026-05-02 (später als A).
    await seedDashboardOrg(D_ORG_A, D_USER_A, "a", { invoices: 2, createdAt: `${TODAY}T10:00:00Z`, scanAt: "2026-05-01T10:00:00Z" });
    await seedDashboardOrg(D_ORG_B, D_USER_B, "b", { invoices: 3, createdAt: "2020-01-01T10:00:00Z", scanAt: "2026-05-02T10:00:00Z" });
  });
  afterEach(cleanupDashboard);

  it("getAutomationStats: exported/captured counts are org-scoped", async () => {
    const a = await getAutomationStats(D_ORG_A);
    const b = await getAutomationStats(D_ORG_B);
    expect(a.exportedLifetime).toBe(2);
    expect(a.capturedCount).toBe(2);
    expect(b.exportedLifetime).toBe(3);
  });

  it("getMonthlyKpis: total is org-scoped (no cross-tenant sum)", async () => {
    expect((await getMonthlyKpis(MONTH, D_ORG_A)).total).toBe(2);
    expect((await getMonthlyKpis(MONTH, D_ORG_B)).total).toBe(3);
  });

  it("getDailyTimeseries: count is org-scoped", async () => {
    const sumA = (await getDailyTimeseries(30, D_ORG_A)).reduce((s, r) => s + r.count, 0);
    const sumB = (await getDailyTimeseries(30, D_ORG_B)).reduce((s, r) => s + r.count, 0);
    expect(sumA).toBe(2);
    expect(sumB).toBe(3);
  });

  it("getObservationStartDate: returns own org's earliest, not another's", async () => {
    const a = await getObservationStartDate(D_ORG_A);
    expect(a).not.toBeNull();
    expect(a!).not.toContain("2020"); // A ist von heute, nicht B's 2020-Zeile
    expect((await getObservationStartDate(D_ORG_B))!).toContain("2020");
  });

  it("getLastScanAt: returns own org's last scan, not another's later one", async () => {
    expect((await getLastScanAt(D_ORG_A))!).toContain("2026-05-01");
    expect((await getLastScanAt(D_ORG_B))!).toContain("2026-05-02");
  });

  it("getPrimaryMailAccount/getSecondaryMailAccount: org-scoped (mailbox-leak regression)", async () => {
    expect((await getPrimaryMailAccount(D_ORG_A))?.username).toBe("primary-a@iso.local");
    expect((await getPrimaryMailAccount(D_ORG_B))?.username).toBe("primary-b@iso.local");
    expect((await getSecondaryMailAccount(D_ORG_A))?.username).toBe("secondary-a@iso.local");
    expect((await getSecondaryMailAccount(D_ORG_B))?.username).toBe("secondary-b@iso.local");
  });
});
