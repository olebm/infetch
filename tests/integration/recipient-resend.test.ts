import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { sql } from "@/lib/db/client";
import { resendSentInvoicesForTarget } from "@/exports/export-pipeline";

// Re-Send beim Absende-Konto-Wechsel: bereits versendete Rechnungen eines
// Empfängers werden auf 'pending' zurückgesetzt (→ erneuter Versand über die
// neue Adresse). Nur 'sent' des betroffenen Targets; 'skipped' und andere
// Targets bleiben unberührt.

const SUFFIX = `${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
const ORG = `org-resend-${SUFFIX}`;
const USER = `user-resend-${SUFFIX}`;
const hasDb = Boolean(process.env.DATABASE_URL);

async function insertTarget(target: string): Promise<number> {
  const rows = await sql<{ id: number }[]>`
    INSERT INTO export_targets (organization_id, target, label, recipient_email, smtp_slot, enabled)
    VALUES (${ORG}, ${target}, ${target}, ${`${target}@example.com`}, 'primary', TRUE)
    RETURNING id
  `;
  return rows[0].id;
}

async function insertInvoice(): Promise<number> {
  const rows = await sql<{ id: number }[]>`
    INSERT INTO invoices (source, status, organization_id)
    VALUES ('mail', 'exported', ${ORG}) RETURNING id
  `;
  return rows[0].id;
}

async function insertExport(invoiceId: number, targetId: number, status: string): Promise<void> {
  await sql`
    INSERT INTO exports (invoice_id, export_target_id, status, organization_id)
    VALUES (${invoiceId}, ${targetId}, ${status}, ${ORG})
  `;
}

async function statusOf(invoiceId: number, targetId: number): Promise<string | undefined> {
  const rows = await sql<{ status: string }[]>`
    SELECT status FROM exports WHERE invoice_id = ${invoiceId} AND export_target_id = ${targetId}
  `;
  return rows[0]?.status;
}

async function cleanup() {
  await sql`DELETE FROM exports WHERE organization_id = ${ORG}`;
  await sql`DELETE FROM export_targets WHERE organization_id = ${ORG}`;
  await sql`DELETE FROM invoices WHERE organization_id = ${ORG}`;
  await sql`DELETE FROM organizations WHERE id = ${ORG}`;
  await sql`DELETE FROM users WHERE id = ${USER}`;
}

describe.skipIf(!hasDb)("resendSentInvoicesForTarget", () => {
  beforeEach(async () => {
    await cleanup();
    await sql`INSERT INTO users (id, email, name) VALUES (${USER}, ${`${USER}@infetch.local`}, 'R') ON CONFLICT DO NOTHING`;
    await sql`
      INSERT INTO organizations (id, name, slug, tier, owner_user_id)
      VALUES (${ORG}, 'Resend', ${ORG}, 'free', ${USER})
      ON CONFLICT DO NOTHING
    `;
  });
  afterEach(cleanup);

  it("setzt nur 'sent'-Exports des Targets auf 'pending'", async () => {
    const kontist = await insertTarget("kontist");
    const accountable = await insertTarget("accountable");
    const inv1 = await insertInvoice();
    const inv2 = await insertInvoice();
    const inv3 = await insertInvoice();
    await insertExport(inv1, kontist, "sent"); // → wird zurückgesetzt
    await insertExport(inv2, kontist, "skipped"); // bleibt (bewusst übersprungen)
    await insertExport(inv3, accountable, "sent"); // anderes Target → bleibt

    const count = await resendSentInvoicesForTarget(ORG, "kontist");

    expect(count).toBe(1);
    expect(await statusOf(inv1, kontist)).toBe("pending");
    expect(await statusOf(inv2, kontist)).toBe("skipped");
    expect(await statusOf(inv3, accountable)).toBe("sent");
  });

  it("ohne versendete Rechnungen: 0 zurückgesetzt", async () => {
    const kontist = await insertTarget("kontist");
    const inv = await insertInvoice();
    await insertExport(inv, kontist, "skipped");

    const count = await resendSentInvoicesForTarget(ORG, "kontist");

    expect(count).toBe(0);
    expect(await statusOf(inv, kontist)).toBe("skipped");
  });
});
