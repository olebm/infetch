import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { sql } from "@/lib/db/client";
import { createScopedSql } from "@/lib/db/scoped-query";

// INFETCH-249: Ein neu angelegter Empfänger bekommt per Default nur KÜNFTIGE
// Rechnungen — bestehende werden als 'skipped' vor-markiert. Nur wenn der User
// "Bestehende auch senden" (includeExisting) wählt, bleibt die Markierung aus.

const SUFFIX = `${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
const ORG = `org-skip-${SUFFIX}`;
const USER = `user-skip-${SUFFIX}`;
const hasDb = Boolean(process.env.DATABASE_URL);

vi.mock("@/lib/auth/current", () => {
  const auth = () => ({
    session: {},
    user: { id: USER },
    organization: { id: ORG, name: "Skip", slug: ORG, tier: "free", ownerUserId: USER },
    scopedSql: createScopedSql(ORG),
  });
  return { getCurrentAuth: async () => auth(), requireCurrentAuth: async () => auth() };
});
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));

import { saveExportTargetAction } from "@/app/(app)/einstellungen/actions";

function fd(fields: Record<string, string>): FormData {
  const f = new FormData();
  for (const [k, v] of Object.entries(fields)) f.set(k, v);
  return f;
}

async function insertInvoice(status: string): Promise<void> {
  await sql`
    INSERT INTO invoices (source, status, organization_id)
    VALUES ('mail', ${status}, ${ORG})
  `;
}

async function exportStatusesFor(target: string): Promise<string[]> {
  const rows = await sql<{ status: string }[]>`
    SELECT exports.status FROM exports
    JOIN export_targets ON export_targets.id = exports.export_target_id
    WHERE export_targets.organization_id = ${ORG} AND export_targets.target = ${target}
  `;
  return rows.map((r) => r.status);
}

async function cleanup() {
  await sql`DELETE FROM exports WHERE organization_id = ${ORG}`;
  await sql`DELETE FROM export_targets WHERE organization_id = ${ORG}`;
  await sql`DELETE FROM invoices WHERE organization_id = ${ORG}`;
  await sql`DELETE FROM organizations WHERE id = ${ORG}`;
  await sql`DELETE FROM users WHERE id = ${USER}`;
}

describe.skipIf(!hasDb)("Neuer Empfänger: bestehende Rechnungen skippen (INFETCH-249)", () => {
  beforeEach(async () => {
    await cleanup();
    await sql`INSERT INTO users (id, email, name) VALUES (${USER}, ${`${USER}@infetch.local`}, 'S') ON CONFLICT DO NOTHING`;
    await sql`
      INSERT INTO organizations (id, name, slug, tier, owner_user_id)
      VALUES (${ORG}, 'Skip', ${ORG}, 'free', ${USER})
      ON CONFLICT DO NOTHING
    `;
  });
  afterEach(cleanup);

  it("Default: alle bestehenden Rechnungen werden für den neuen Empfänger als 'skipped' markiert", async () => {
    await insertInvoice("ready");
    await insertInvoice("exported");
    await insertInvoice("new"); // auch noch-nicht-fertige bleiben übersprungen

    const result = await saveExportTargetAction(
      { status: "idle", message: "" },
      fd({
        exportTarget: "kontist",
        recipientEmail: "belege@kontist.com",
        smtpSlot: "primary",
        enabled: "on",
        // includeExisting nicht gesetzt → Default: nur künftige
      }),
    );
    expect(result.status).toBe("success");

    const statuses = await exportStatusesFor("kontist");
    expect(statuses.length).toBe(3);
    expect(statuses.every((s) => s === "skipped")).toBe(true);
  });

  it("includeExisting=on: keine Vor-Markierung — bestehende laufen normal", async () => {
    await insertInvoice("ready");
    await insertInvoice("exported");

    await saveExportTargetAction(
      { status: "idle", message: "" },
      fd({
        exportTarget: "accountable",
        recipientEmail: "expenses@accountable.eu",
        smtpSlot: "primary",
        enabled: "on",
        includeExisting: "on",
      }),
    );

    const statuses = await exportStatusesFor("accountable");
    expect(statuses.length).toBe(0);
  });
});
