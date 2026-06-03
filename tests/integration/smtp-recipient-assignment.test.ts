import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { sql } from "@/lib/db/client";

// Verifiziert die Empfänger→Absende-Konto-Zuweisung (INFETCH-225): saveExportTargetAction
// persistiert den gewählten smtp_slot und der Upsert wechselt ihn korrekt.

const SUFFIX = `${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
const ORG = `org-smtp-assign-${SUFFIX}`;
const USER = `user-smtp-assign-${SUFFIX}`;

const hasDb = Boolean(process.env.DATABASE_URL);

vi.mock("@/lib/auth/current", () => ({
  getCurrentAuth: async () => ({
    session: {},
    user: { id: USER },
    organization: { id: ORG, name: "SMTP Assign", slug: ORG, tier: "free", ownerUserId: USER },
  }),
  requireCurrentAuth: async () => ({
    session: {},
    user: { id: USER },
    organization: { id: ORG, name: "SMTP Assign", slug: ORG, tier: "free", ownerUserId: USER },
  }),
}));

vi.mock("next/cache", () => ({ revalidatePath: () => {} }));

import { saveExportTargetAction } from "@/app/(app)/einstellungen/actions";

function fd(fields: Record<string, string>): FormData {
  const f = new FormData();
  for (const [k, v] of Object.entries(fields)) f.set(k, v);
  return f;
}

async function smtpSlotFor(target: string): Promise<string | null> {
  const rows = await sql<{ smtp_slot: string }[]>`
    SELECT smtp_slot FROM export_targets WHERE organization_id = ${ORG} AND target = ${target} LIMIT 1
  `;
  return rows[0]?.smtp_slot ?? null;
}

async function cleanup() {
  await sql`DELETE FROM export_targets WHERE organization_id = ${ORG}`;
  await sql`DELETE FROM organizations WHERE id = ${ORG}`;
  await sql`DELETE FROM users WHERE id = ${USER}`;
}

describe.skipIf(!hasDb)("Empfänger → Absende-Konto-Zuweisung", () => {
  beforeEach(async () => {
    await cleanup();
    await sql`INSERT INTO users (id, email, name) VALUES (${USER}, ${`${USER}@infetch.local`}, 'Assign') ON CONFLICT DO NOTHING`;
    await sql`
      INSERT INTO organizations (id, name, slug, tier, owner_user_id)
      VALUES (${ORG}, 'SMTP Assign', ${ORG}, 'free', ${USER})
      ON CONFLICT DO NOTHING
    `;
  });
  afterEach(cleanup);

  it("speichert den gewählten Slot (secondary) am Empfänger", async () => {
    const result = await saveExportTargetAction(
      { status: "idle", message: "" },
      fd({
        exportTarget: "accountable",
        recipientEmail: "expenses@accountable.eu",
        smtpSlot: "secondary",
        enabled: "on",
      }),
    );
    expect(result.status).toBe("success");
    expect(await smtpSlotFor("accountable")).toBe("secondary");
  });

  it("Upsert wechselt den Slot eines bestehenden Empfängers (secondary → primary)", async () => {
    await saveExportTargetAction(
      { status: "idle", message: "" },
      fd({
        exportTarget: "kontist",
        recipientEmail: "belege@kontist.com",
        smtpSlot: "secondary",
        enabled: "on",
      }),
    );
    expect(await smtpSlotFor("kontist")).toBe("secondary");

    const result = await saveExportTargetAction(
      { status: "idle", message: "" },
      fd({
        exportTarget: "kontist",
        recipientEmail: "belege@kontist.com",
        smtpSlot: "primary",
        enabled: "on",
      }),
    );
    expect(result.status).toBe("success");
    expect(await smtpSlotFor("kontist")).toBe("primary");
  });

  it("weist Kontist und Accountable je ein eigenes Absende-Konto zu", async () => {
    await saveExportTargetAction(
      { status: "idle", message: "" },
      fd({
        exportTarget: "kontist",
        recipientEmail: "belege@kontist.com",
        smtpSlot: "primary",
        enabled: "on",
      }),
    );
    await saveExportTargetAction(
      { status: "idle", message: "" },
      fd({
        exportTarget: "accountable",
        recipientEmail: "expenses@accountable.eu",
        smtpSlot: "secondary",
        enabled: "on",
      }),
    );
    expect(await smtpSlotFor("kontist")).toBe("primary");
    expect(await smtpSlotFor("accountable")).toBe("secondary");
  });
});
