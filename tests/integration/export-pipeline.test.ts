import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { sql } from "@/lib/db/client";
import { enqueueReadyInvoices, dispatchPendingExports } from "@/exports/export-pipeline";

// ── Fixtures ──────────────────────────────────────────────────────────────────

const TEST_ORG_ID = `org-export-test-${Date.now()}`;
const TEST_USER_ID = `user-export-test-${Date.now()}`;

async function setupOrg(tier: "free" | "pro" | "business" = "pro") {
  await sql`
    INSERT INTO users (id, email, name)
    VALUES (${TEST_USER_ID}, ${`export-test-${Date.now()}@infetch.local`}, 'Export Test')
    ON CONFLICT DO NOTHING
  `;
  await sql`
    INSERT INTO organizations (id, name, slug, tier, owner_user_id)
    VALUES (
      ${TEST_ORG_ID},
      'Export Test Org',
      ${`export-test-${Date.now()}`},
      ${tier},
      ${TEST_USER_ID}
    )
    ON CONFLICT DO NOTHING
  `;
}

async function insertReadyInvoice(): Promise<number> {
  const [row] = await sql<{ id: number }[]>`
    INSERT INTO invoices (organization_id, source, status, confidence, dedupe_key)
    VALUES (
      ${TEST_ORG_ID},
      'manual',
      'ready',
      0.95,
      ${`export-test-${Date.now()}-${Math.random()}`}
    )
    RETURNING id
  `;
  return row.id;
}

async function insertExportTarget(recipientEmail = "buchhaltung@test.de") {
  await sql`
    INSERT INTO export_targets (organization_id, target, label, recipient_email, enabled)
    VALUES (${TEST_ORG_ID}, 'accountable', 'Test Buchhaltung', ${recipientEmail}, TRUE)
    ON CONFLICT DO NOTHING
  `;
}

async function cleanup() {
  await sql`DELETE FROM exports WHERE invoice_id IN (SELECT id FROM invoices WHERE organization_id = ${TEST_ORG_ID})`;
  await sql`DELETE FROM export_targets WHERE organization_id = ${TEST_ORG_ID}`;
  await sql`DELETE FROM invoice_files WHERE invoice_id IN (SELECT id FROM invoices WHERE organization_id = ${TEST_ORG_ID})`;
  await sql`DELETE FROM invoices WHERE organization_id = ${TEST_ORG_ID}`;
  await sql`DELETE FROM organizations WHERE id = ${TEST_ORG_ID}`;
  await sql`DELETE FROM users WHERE id = ${TEST_USER_ID}`;
}

describe("Export-Pipeline", () => {
  beforeEach(async () => {
    await cleanup();
  });
  afterEach(cleanup);

  // ── enqueueReadyInvoices ──────────────────────────────────────────────────────

  it("enqueueReadyInvoices legt Exports-Rows für ready-Invoices an", async () => {
    await setupOrg("pro");
    await insertExportTarget();
    const invoiceId = await insertReadyInvoice();

    const count = await enqueueReadyInvoices();
    expect(count).toBeGreaterThan(0);

    const [exportRow] = await sql<{ status: string }[]>`
      SELECT status FROM exports WHERE invoice_id = ${invoiceId}
    `;
    expect(exportRow).toBeTruthy();
    expect(exportRow.status).toBe("pending");
  });

  it("enqueueReadyInvoices erstellt keinen Duplikat-Eintrag (ON CONFLICT DO NOTHING)", async () => {
    await setupOrg("pro");
    await insertExportTarget();
    const invoiceId = await insertReadyInvoice();

    await enqueueReadyInvoices();
    await enqueueReadyInvoices(); // zweites Mal

    const rows = await sql<{ id: number }[]>`
      SELECT id FROM exports WHERE invoice_id = ${invoiceId}
    `;
    expect(rows.length).toBe(1); // keine Duplikate
  });

  it("enqueueReadyInvoices erstellt keine Cross-Tenant-Exports (Org-Isolation)", async () => {
    await setupOrg("pro");
    const invoiceId = await insertReadyInvoice();

    // Export-Target einer anderen Org (kein organization_id → global, aber nicht mehr erlaubt)
    await sql`
      INSERT INTO export_targets (organization_id, target, label, recipient_email, enabled)
      VALUES (NULL, 'accountable', 'Andere Org', 'other@test.de', TRUE)
      ON CONFLICT DO NOTHING
    `;

    await enqueueReadyInvoices();

    const rows = await sql<{ id: number }[]>`
      SELECT id FROM exports WHERE invoice_id = ${invoiceId}
    `;
    // Das NULL-Target darf die Invoice dieser Org nicht erhalten
    expect(rows.length).toBe(0);
  });

  it("enqueueReadyInvoices ignoriert deaktivierte Export-Targets", async () => {
    await setupOrg("pro");
    await sql`
      INSERT INTO export_targets (organization_id, target, label, recipient_email, enabled)
      VALUES (${TEST_ORG_ID}, 'accountable', 'Disabled Target', 'disabled@test.de', FALSE)
      ON CONFLICT DO NOTHING
    `;
    const invoiceId = await insertReadyInvoice();

    await enqueueReadyInvoices();

    const rows = await sql<{ id: number }[]>`
      SELECT id FROM exports WHERE invoice_id = ${invoiceId}
    `;
    expect(rows.length).toBe(0);
  });

  // ── dispatchPendingExports ────────────────────────────────────────────────────

  it("dispatchPendingExports blockiert Export für Free-Tier-Org (tier-gate)", async () => {
    await setupOrg("free"); // Free: exportEnabled=false
    await insertExportTarget();
    const invoiceId = await insertReadyInvoice();
    await enqueueReadyInvoices();

    const result = await dispatchPendingExports();

    // Org ist Free → kein Export erlaubt
    expect(result.sent).toBe(0);

    // Export-Row bleibt 'pending' oder wird als 'blocked' markiert
    const [exportRow] = await sql<{ status: string }[]>`
      SELECT status FROM exports WHERE invoice_id = ${invoiceId}
    `;
    expect(["pending", "blocked", "skipped"]).toContain(exportRow?.status);
  });

  it("dispatchPendingExports schlägt fehl wenn kein SMTP konfiguriert (Pro-Org)", async () => {
    await setupOrg("pro");
    await insertExportTarget("buchhaltung@test.de");
    const invoiceId = await insertReadyInvoice();

    // Manuelle invoice_files Row nötig damit Pipeline nicht abbricht
    await sql`
      INSERT INTO invoice_files (invoice_id, original_filename, stored_path, sha256, size_bytes, mime_type, source_type)
      VALUES (${invoiceId}, 'rechnung.pdf', 'test/path.pdf', ${`sha-${Date.now()}`}, 1024, 'application/pdf', 'manual')
    `;

    await enqueueReadyInvoices();
    const result = await dispatchPendingExports();

    // Pro-Org, aber kein SMTP konfiguriert → failed
    expect(result.failed).toBeGreaterThan(0);
    expect(result.sent).toBe(0);
  });
});
