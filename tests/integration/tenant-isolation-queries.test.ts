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
  getRecentScans,
  getVendorInvoices,
  getTopVendors,
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
// Vergangener Monat: wird vom Timing-Gate (isMissingDue) als fällig gewertet,
// sodass die „fehlt"-Zeile erscheint. Ein Zukunftsmonat würde als „noch nicht
// fällig" herausgefiltert. Org+Vendor sind pro Lauf eindeutig → keine Kollision.
const YM = "2025-03";

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
  // Echte Historie: das Evidenz-Gate von getMissingItems/getMissingMatrix zeigt
  // einen Vendor nur, wenn die Org von ihm schon mind. eine erkannte Rechnung
  // (mit Datum, nicht ignoriert/Dublette) hatte. Eine exportierte Alt-Rechnung
  // genügt — der Isolations-Kontrakt unten bleibt davon unberührt.
  await sql`
    INSERT INTO invoices
      (organization_id, vendor_id, source, status, invoice_date, amount_gross, currency, confidence, dedupe_key)
    VALUES
      (${orgId}, ${vendor.id}, 'manual', 'exported', '2025-01-10', 49, 'EUR', 0.9, ${`iso-hist-${key}`})
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

  it("getRecentScans: returns only own org's scans (Einstellungen scan history)", async () => {
    const scansA = await getRecentScans(10, D_ORG_A);
    const scansB = await getRecentScans(10, D_ORG_B);
    expect(scansA).toHaveLength(1);
    expect(scansB).toHaveLength(1);
    expect(scansA[0].startedAt).toContain("2026-05-01");
    expect(scansB[0].startedAt).toContain("2026-05-02");
  });

  it("getVendorInvoices: org-scoped for a SHARED global vendor (senders detail)", async () => {
    const gKey = `dash-global-${SUFFIX}`;
    const [gv] = await sql<{ id: number }[]>`
      INSERT INTO vendors (name, canonical_key, category, organization_id)
      VALUES ('Global Shared', ${gKey}, 'saas', NULL) RETURNING id
    `;
    try {
      await sql`INSERT INTO invoices (organization_id, source, status, confidence, dedupe_key, vendor_id) VALUES (${D_ORG_A}, 'manual', 'exported', 0.9, ${`gv-a-${SUFFIX}`}, ${gv.id})`;
      await sql`INSERT INTO invoices (organization_id, source, status, confidence, dedupe_key, vendor_id) VALUES (${D_ORG_B}, 'manual', 'exported', 0.9, ${`gv-b-${SUFFIX}`}, ${gv.id})`;
      expect(await getVendorInvoices(gv.id, D_ORG_A)).toHaveLength(1);
      expect(await getVendorInvoices(gv.id, D_ORG_B)).toHaveLength(1);
    } finally {
      await sql`DELETE FROM invoices WHERE vendor_id = ${gv.id}`;
      await sql`DELETE FROM vendors WHERE id = ${gv.id}`;
    }
  });

  it("getPrimaryMailAccount/getSecondaryMailAccount: org-scoped (mailbox-leak regression)", async () => {
    expect((await getPrimaryMailAccount(D_ORG_A))?.username).toBe("primary-a@iso.local");
    expect((await getPrimaryMailAccount(D_ORG_B))?.username).toBe("primary-b@iso.local");
    expect((await getSecondaryMailAccount(D_ORG_A))?.username).toBe("secondary-a@iso.local");
    expect((await getSecondaryMailAccount(D_ORG_B))?.username).toBe("secondary-b@iso.local");
  });
});

// ── Dashboard-Datums-Basis: updated_at (Versand-/Verarbeitungszeit), NICHT
// invoice_date (Dokumentdatum). Regression-Guard für den Trust-Bug, bei dem der
// Erstscan Alt-Rechnungen (Rechnungsdatum vor Account-Existenz) importiert und
// das Dashboard „automatisch versendet" in Monaten vor dem Account zeigte.
// Szenario: 1 exportierte Rechnung mit invoice_date 2020-02-15, aber updated_at
// = jetzt (Default beim Insert) → muss im AKTUELLEN Monat zählen, nicht im
// Dokumentmonat 2020-02.
const DB_ORG = `dbasis-${SUFFIX}`;
const DB_USER = `dbasis-u-${SUFFIX}`;
const DB_NOW_MONTH = new Date().toISOString().slice(0, 7);

describe.skipIf(!hasDb)("dashboard date basis — updated_at, not invoice_date", () => {
  beforeEach(async () => {
    await sql`DELETE FROM invoices WHERE organization_id = ${DB_ORG}`;
    await sql`DELETE FROM organizations WHERE id = ${DB_ORG}`;
    await sql`DELETE FROM users WHERE id = ${DB_USER}`;
    await sql`INSERT INTO users (id, email, name) VALUES (${DB_USER}, ${`${DB_USER}@iso.local`}, 'DB') ON CONFLICT DO NOTHING`;
    await sql`INSERT INTO organizations (id, name, slug, tier, owner_user_id) VALUES (${DB_ORG}, ${DB_ORG}, ${DB_ORG}, 'pro', ${DB_USER}) ON CONFLICT DO NOTHING`;
    // Alt-Dokument (invoice_date 2020), heute erfasst+exportiert (updated_at = Default now()).
    await sql`
      INSERT INTO invoices (organization_id, source, status, confidence, dedupe_key, invoice_date, amount_gross, created_at)
      VALUES (${DB_ORG}, 'manual', 'exported', 0.9, ${`dbasis-inv-${SUFFIX}`}, '2020-02-15', 42, NOW())
    `;
  });
  afterEach(async () => {
    await sql`DELETE FROM invoices WHERE organization_id = ${DB_ORG}`;
    await sql`DELETE FROM organizations WHERE id = ${DB_ORG}`;
    await sql`DELETE FROM users WHERE id = ${DB_USER}`;
  });

  it("getMonthlyKpis: zählt im Verarbeitungsmonat (jetzt), nicht im Rechnungsmonat (2020-02)", async () => {
    expect((await getMonthlyKpis(DB_NOW_MONTH, DB_ORG)).total).toBe(1);
    expect((await getMonthlyKpis("2020-02", DB_ORG)).total).toBe(0);
  });

  it("getDailyTimeseries: Alt-Rechnung erscheint im 30-Tage-Fenster (updated_at heute)", async () => {
    const sum = (await getDailyTimeseries(30, DB_ORG)).reduce((s, r) => s + r.count, 0);
    expect(sum).toBe(1); // unter invoice_date-Basis wäre 2020 außerhalb des Fensters → 0
  });

  it("getTopVendors: deltaPrevMonth nach Verarbeitungszeit (updated_at), nicht Rechnungsdatum", async () => {
    const vKey = `dbasis-vendor-${SUFFIX}`;
    const [v] = await sql<{ id: number }[]>`
      INSERT INTO vendors (name, canonical_key, category, organization_id)
      VALUES ('DBasis Vendor', ${vKey}, 'saas', ${DB_ORG}) RETURNING id
    `;
    try {
      await sql`
        INSERT INTO invoices (organization_id, source, status, confidence, dedupe_key, invoice_date, amount_gross, created_at, vendor_id)
        VALUES (${DB_ORG}, 'manual', 'exported', 0.9, ${`dbasis-tv-${SUFFIX}`}, '2020-02-15', 42, NOW(), ${v.id})
      `;
      const row = (await getTopVendors(5, DB_ORG)).find((r) => r.vendorName === "DBasis Vendor");
      expect(row).toBeDefined();
      expect(row!.count).toBe(1);
      // updated_at = jetzt → curCount=1, prevCount=0 → delta=1.
      // Unter invoice_date-Basis (2020-02) wäre curCount=0 → delta=0.
      expect(row!.deltaPrevMonth).toBe(1);
    } finally {
      await sql`DELETE FROM invoices WHERE vendor_id = ${v.id}`;
      await sql`DELETE FROM vendors WHERE id = ${v.id}`;
    }
  });
});
