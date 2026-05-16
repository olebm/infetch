import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { sql } from "@/lib/db/client";
import {
  canImportInvoice,
  canStoreFile,
  getMonthlyImportCount,
  isNearInvoiceLimit,
} from "@/lib/tier";

// ── Test-Org + Fixtures ───────────────────────────────────────────────────────

const TEST_ORG_ID = `org-quota-test-${Date.now()}`;
const TEST_USER_ID = `user-quota-test-${Date.now()}`;

async function setupOrg(tier: "free" | "pro" | "business" = "free") {
  await sql`
    INSERT INTO users (id, email, name)
    VALUES (${TEST_USER_ID}, ${`quota-test-${Date.now()}@infetch.local`}, 'Quota Test')
    ON CONFLICT DO NOTHING
  `;
  await sql`
    INSERT INTO organizations (id, name, slug, tier, owner_user_id)
    VALUES (
      ${TEST_ORG_ID},
      'Quota Test Org',
      ${`quota-test-${Date.now()}`},
      ${tier},
      ${TEST_USER_ID}
    )
    ON CONFLICT DO NOTHING
  `;
}

/**
 * Batch-Insert für Invoices — ein einziger Round-Trip statt N Queries.
 * monthOffset: Rechnungen in vergangenen Monat verschieben (1 = letzter Monat).
 */
async function insertInvoices(count: number, opts: { monthOffset?: number } = {}) {
  const offset = opts.monthOffset ?? 0;
  const ts = Date.now();

  if (offset === 0) {
    // Aktueller Monat — Standard created_at (NOW())
    const rows = Array.from({ length: count }, (_, i) => ({
      organization_id: TEST_ORG_ID,
      source: "manual",
      status: "ready",
      confidence: 0.9,
      dedupe_key: `quota-test-${ts}-${i}-${Math.random()}`,
    }));
    await sql`INSERT INTO invoices ${sql(rows, "organization_id", "source", "status", "confidence", "dedupe_key")}`;
  } else {
    // Vergangener Monat — created_at explizit setzen
    const past = new Date();
    past.setMonth(past.getMonth() - offset);
    const pastStr = past.toISOString().slice(0, 19).replace("T", " ");
    const rows = Array.from({ length: count }, (_, i) => ({
      organization_id: TEST_ORG_ID,
      source: "manual",
      status: "ready",
      confidence: 0.9,
      dedupe_key: `quota-test-${ts}-past-${i}-${Math.random()}`,
      created_at: pastStr,
    }));
    await sql`INSERT INTO invoices ${sql(rows, "organization_id", "source", "status", "confidence", "dedupe_key", "created_at")}`;
  }
}

async function insertFileForStorage(sizeBytes: number) {
  const [invoice] = await sql<{ id: number }[]>`
    INSERT INTO invoices (organization_id, source, status, confidence, dedupe_key)
    VALUES (${TEST_ORG_ID}, 'manual', 'ready', 0.9, ${`storage-test-${Date.now()}-${Math.random()}`})
    RETURNING id
  `;
  await sql`
    INSERT INTO invoice_files (
      invoice_id, original_filename, stored_path, sha256, size_bytes, mime_type, source_type
    )
    VALUES (
      ${invoice.id},
      'test.pdf',
      ${"test/path.pdf"},
      ${`sha256-${Date.now()}-${Math.random()}`},
      ${sizeBytes},
      'application/pdf',
      'manual'
    )
  `;
}

async function cleanup() {
  await sql`DELETE FROM exports WHERE invoice_id IN (SELECT id FROM invoices WHERE organization_id = ${TEST_ORG_ID})`;
  await sql`DELETE FROM invoice_files WHERE invoice_id IN (SELECT id FROM invoices WHERE organization_id = ${TEST_ORG_ID})`;
  await sql`DELETE FROM invoices WHERE organization_id = ${TEST_ORG_ID}`;
  await sql`DELETE FROM organizations WHERE id = ${TEST_ORG_ID}`;
  await sql`DELETE FROM users WHERE id = ${TEST_USER_ID}`;
}

describe("Quota-Enforcement (Tier-System)", () => {
  beforeEach(async () => {
    await cleanup();
  });
  afterEach(cleanup);

  // ── Monats-Zähler ────────────────────────────────────────────────────────────

  it("getMonthlyImportCount zählt nur Rechnungen des aktuellen Monats", async () => {
    await setupOrg("free");

    await insertInvoices(3); // aktueller Monat
    await insertInvoices(2, { monthOffset: 1 }); // Vormonat — soll nicht zählen

    const count = await getMonthlyImportCount(TEST_ORG_ID);
    expect(count).toBe(3);
  });

  it("getMonthlyImportCount gibt 0 zurück bei leerer Org", async () => {
    await setupOrg("free");
    const count = await getMonthlyImportCount(TEST_ORG_ID);
    expect(count).toBe(0);
  });

  // ── canImportInvoice ──────────────────────────────────────────────────────────

  it("canImportInvoice gibt allowed=true zurück wenn unter dem Free-Limit (15)", async () => {
    await setupOrg("free");
    await insertInvoices(14);
    const result = await canImportInvoice(TEST_ORG_ID);
    expect(result.allowed).toBe(true);
    expect(result.current).toBe(14);
    expect(result.max).toBe(15);
  });

  it("canImportInvoice gibt allowed=false zurück wenn Free-Limit erreicht (15)", async () => {
    await setupOrg("free");
    await insertInvoices(15);
    const result = await canImportInvoice(TEST_ORG_ID);
    expect(result.allowed).toBe(false);
    expect(result.current).toBe(15);
  });

  it("canImportInvoice gibt allowed=true für Pro-Org unter 150", async () => {
    await setupOrg("pro");
    await insertInvoices(30); // Pro erlaubt 150
    const result = await canImportInvoice(TEST_ORG_ID);
    expect(result.allowed).toBe(true);
    expect(result.max).toBe(150);
  });

  it("canImportInvoice gibt allowed=false wenn Pro-Limit erreicht (150)", async () => {
    await setupOrg("pro");
    await insertInvoices(150); // Batch-Insert: ein Round-Trip
    const result = await canImportInvoice(TEST_ORG_ID);
    expect(result.allowed).toBe(false);
  }, 30_000); // 30s Timeout für Remote-DB mit 150 Rows

  it("canImportInvoice gibt always allowed=true für Business (unbegrenzt)", async () => {
    // Business short-circuits ohne DB-Abfrage — nur 1 Row nötig
    await setupOrg("business");
    await insertInvoices(1);
    const result = await canImportInvoice(TEST_ORG_ID);
    expect(result.allowed).toBe(true);
  });

  // ── canStoreFile ──────────────────────────────────────────────────────────────

  it("canStoreFile erlaubt Upload wenn unter dem Storage-Limit", async () => {
    await setupOrg("free"); // 500 MB Limit
    await insertFileForStorage(100 * 1024 * 1024); // 100 MB belegt

    const result = await canStoreFile(TEST_ORG_ID, 100 * 1024 * 1024); // +100 MB
    expect(result.allowed).toBe(true);
  });

  it("canStoreFile blockiert wenn Speicherlimit überschritten würde", async () => {
    await setupOrg("free"); // 500 MB Limit
    await insertFileForStorage(490 * 1024 * 1024); // 490 MB bereits belegt

    const result = await canStoreFile(TEST_ORG_ID, 20 * 1024 * 1024); // +20 MB = 510 MB > 500 MB
    expect(result.allowed).toBe(false);
  });

  // ── isNearInvoiceLimit ────────────────────────────────────────────────────────

  it("isNearInvoiceLimit gibt false zurück wenn weit unter dem Limit", async () => {
    await setupOrg("free");
    await insertInvoices(5);
    expect(await isNearInvoiceLimit(TEST_ORG_ID)).toBe(false);
  });

  it("isNearInvoiceLimit gibt true zurück bei ≥80% des Limits", async () => {
    await setupOrg("free"); // Limit: 15 → 80% = 12
    await insertInvoices(12);
    expect(await isNearInvoiceLimit(TEST_ORG_ID)).toBe(true);
  });

  it("isNearInvoiceLimit gibt false für Business (unbegrenzt)", async () => {
    await setupOrg("business"); // Business short-circuits → immer false
    expect(await isNearInvoiceLimit(TEST_ORG_ID)).toBe(false);
  });
});
