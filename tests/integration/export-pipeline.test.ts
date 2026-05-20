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

  it("dispatchPendingExports versendet auch für Free-Tier (SMTP-Forward ist tier-unabhängig)", async () => {
    // Regression-Schutz für Free-only Launch: vor dem Fix blockierte die
    // Pipeline jeden Export-Row für Free → SMTP-Forward funktionierte nicht
    // mehr (siehe canExport-Doc in tier.ts). Free MUSS senden dürfen,
    // sobald SMTP konfiguriert ist. API-Direkt-Push (Lexoffice/sevDesk)
    // bleibt davon unberührt und wird in auto-transfer.ts gegated.
    await setupOrg("free");
    await insertExportTarget();
    const invoiceId = await insertReadyInvoice();
    await enqueueReadyInvoices();

    const result = await dispatchPendingExports();

    // Free ohne SMTP-Credentials → failed (nicht blocked).
    // Wichtig: Pipeline läuft durch und ruft sendInvoiceMail auf, statt
    // den Row vorher mit "Export nicht im aktuellen Plan" zu blocken.
    expect(result.failed).toBeGreaterThan(0);
    expect(result.sent).toBe(0);

    const [exportRow] = await sql<{ status: string; lastError: string | null }[]>`
      SELECT status, last_error AS "lastError"
      FROM exports WHERE invoice_id = ${invoiceId}
    `;
    expect(exportRow?.status).toBe("failed");
    expect(exportRow?.lastError ?? "").not.toMatch(/Plan/);
  });

  it("dispatchPendingExports markiert Export als failed wenn kein PDF vorhanden", async () => {
    // Vorher testete dieser Block den "Pro-Org ohne SMTP"-Pfad, aber im
    // Free-only Launch (proEnabled=false) returnt getOrgTier immer "free",
    // also war der vermeintliche Pro-Test in Wirklichkeit ein Free-Test
    // gegen den alten canExport-Block. Der ehrliche Smoke-Test: Pipeline
    // läuft durch und scheitert geordnet (status=failed, kein Hang).
    await setupOrg("free");
    await insertExportTarget("buchhaltung@test.de");
    const invoiceId = await insertReadyInvoice();
    // Bewusst KEIN invoice_files-Row → Pipeline scheitert mit "Keine PDF-Datei"

    await enqueueReadyInvoices();
    const result = await dispatchPendingExports();

    expect(result.failed).toBeGreaterThan(0);
    expect(result.sent).toBe(0);

    const [exportRow] = await sql<{ status: string; lastError: string | null }[]>`
      SELECT status, last_error AS "lastError"
      FROM exports WHERE invoice_id = ${invoiceId}
    `;
    expect(exportRow?.status).toBe("failed");
    expect(exportRow?.lastError ?? "").toMatch(/Keine PDF-Datei/);
  });
});
