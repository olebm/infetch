import { beforeAll, describe, expect, it } from "vitest";
import { sql } from "@/lib/db/client";
import { updateInvoiceReview } from "@/invoices/review";

// NOTE: updateInvoiceReview now uses the global postgres sql client.
// This test requires a real Postgres connection with seeded vendor data.

const TEST_ORG_ID = `rev-test-org-${Date.now()}`;
const TEST_USER_ID = `rev-test-user-${Date.now()}`;

beforeAll(async () => {
  await sql`INSERT INTO users (id, email, name) VALUES (${TEST_USER_ID}, ${`${TEST_USER_ID}@local`}, 'Rev') ON CONFLICT DO NOTHING`;
  await sql`
    INSERT INTO organizations (id, name, slug, tier, owner_user_id)
    VALUES (${TEST_ORG_ID}, ${TEST_ORG_ID}, ${TEST_ORG_ID}, 'pro', ${TEST_USER_ID})
    ON CONFLICT DO NOTHING
  `;
});

async function getVendorId(canonicalKey: string): Promise<number | undefined> {
  // Globale Built-in-Vendors (organization_id IS NULL) sind für jede Org sichtbar.
  const rows = await sql<
    { id: number }[]
  >`SELECT id FROM vendors WHERE canonical_key = ${canonicalKey}`;
  return rows[0]?.id;
}

async function insertInvoice(fields: Record<string, unknown> = {}): Promise<number> {
  const rows = await sql<{ id: number }[]>`
    INSERT INTO invoices (organization_id, source, status, confidence, dedupe_key)
    VALUES (
      ${TEST_ORG_ID},
      ${"mail"},
      ${"needs_review"},
      ${0.42},
      ${"rev-test-" + Date.now() + "-" + Math.random()}
    )
    RETURNING id
  `;
  void fields;
  return rows[0].id;
}

describe("invoice review", () => {
  it("updates invoice fields and marks the invoice as ready", async () => {
    const vendorId = await getVendorId("openai");
    const invoiceId = await insertInvoice();

    await updateInvoiceReview({
      organizationId: TEST_ORG_ID,
      invoiceId,
      vendorId: vendorId ?? null,
      invoiceNumber: "INV-2026-05",
      invoiceDate: "2026-05-01",
      servicePeriodStart: "2026-05-01",
      servicePeriodEnd: "2026-05-31",
      amountGross: 29,
      amountNet: 24.37,
      vatAmount: 4.63,
      currency: "EUR",
      status: "ready",
      duplicateOfInvoiceId: null,
      vatRate: 19,
      docType: "invoice",
      preferredExportTargetId: null,
    });

    const rows = await sql<
      {
        vendorId: number | null;
        status: string;
        invoiceNumber: string | null;
        invoiceDate: string | null;
        servicePeriodStart: string | null;
        duplicateOfInvoiceId: number | null;
      }[]
    >`
      SELECT vendor_id AS "vendorId", status, invoice_number AS "invoiceNumber",
        invoice_date AS "invoiceDate",
        service_period_start AS "servicePeriodStart",
        duplicate_of_invoice_id AS "duplicateOfInvoiceId"
      FROM invoices
      WHERE id = ${invoiceId}
    `;
    const invoice = rows[0];

    expect(invoice).toMatchObject({
      vendorId: vendorId ?? null,
      status: "ready",
      invoiceNumber: "INV-2026-05",
      invoiceDate: "2026-05-01",
      servicePeriodStart: "2026-05-01",
      duplicateOfInvoiceId: null,
    });
  });

  it("marks an invoice ready without a catalog vendor (vendor_id NULL is normal)", async () => {
    const invoiceId = await insertInvoice();

    await updateInvoiceReview({
      organizationId: TEST_ORG_ID,
      invoiceId,
      vendorId: null,
      invoiceNumber: "INV-NOVENDOR-1",
      invoiceDate: "2026-05-01",
      servicePeriodStart: null,
      servicePeriodEnd: null,
      amountGross: 42,
      amountNet: null,
      vatAmount: null,
      currency: "EUR",
      status: "ready",
      duplicateOfInvoiceId: null,
      vatRate: null,
      docType: "invoice",
      preferredExportTargetId: null,
    });

    const rows = await sql<{ status: string; vendorId: number | null }[]>`
      SELECT status, vendor_id AS "vendorId" FROM invoices WHERE id = ${invoiceId}
    `;
    expect(rows[0]).toMatchObject({ status: "ready", vendorId: null });
  });

  it("requires a target invoice when marking an invoice as duplicate", async () => {
    const invoiceId = await insertInvoice();

    await expect(
      updateInvoiceReview({
        organizationId: TEST_ORG_ID,
        invoiceId,
        vendorId: null,
        invoiceNumber: null,
        invoiceDate: null,
        servicePeriodStart: null,
        servicePeriodEnd: null,
        amountGross: null,
        amountNet: null,
        vatAmount: null,
        currency: null,
        status: "duplicate",
        duplicateOfInvoiceId: null,
        vatRate: null,
        docType: null,
        preferredExportTargetId: null,
      }),
    ).rejects.toThrow("Bitte eine Zielrechnung für die Dublette auswählen.");
  });
});
