import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { sql } from "@/lib/db/client";
import { createScopedSql } from "@/lib/db/scoped-query";
import { buildSecretRef, hasStoredCredentialRef } from "@/lib/secrets/credential-store";
import { saveStoredSmtpAccount, getStoredSmtpAccount } from "@/mail/smtp-settings";

// Verifiziert das Löschen des 2. Absende-Kontos (secondary): Empfänger fallen
// org-scoped auf Konto 1 zurück, gespeichertes Konto + Credential werden
// entfernt, und das Pflichtkonto (primary) ist gegen Löschen geschützt.

const SUFFIX = `${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
const ORG = `org-smtp-del-${SUFFIX}`;
const USER = `user-smtp-del-${SUFFIX}`;

const hasDb = Boolean(process.env.DATABASE_URL);

vi.mock("@/lib/auth/current", () => {
  const auth = () => ({
    session: {},
    user: { id: USER },
    organization: { id: ORG, name: "SMTP Del", slug: ORG, tier: "free", ownerUserId: USER },
    scopedSql: createScopedSql(ORG),
  });
  return { getCurrentAuth: async () => auth(), requireCurrentAuth: async () => auth() };
});

vi.mock("next/cache", () => ({ revalidatePath: () => {} }));

import { deleteSmtpAccountAction } from "@/app/(app)/einstellungen/actions";

function fd(fields: Record<string, string>): FormData {
  const f = new FormData();
  for (const [k, v] of Object.entries(fields)) f.set(k, v);
  return f;
}

const secondarySecretRef = buildSecretRef("smtp", "secondary", ORG);

async function smtpSlotFor(target: string): Promise<string | null> {
  const rows = await sql<{ smtp_slot: string }[]>`
    SELECT smtp_slot FROM export_targets WHERE organization_id = ${ORG} AND target = ${target} LIMIT 1
  `;
  return rows[0]?.smtp_slot ?? null;
}

async function insertTarget(target: string, slot: string): Promise<void> {
  await sql`
    INSERT INTO export_targets (organization_id, target, label, recipient_email, smtp_slot, enabled)
    VALUES (${ORG}, ${target}, ${target}, ${`${target}@example.com`}, ${slot}, TRUE)
  `;
}

async function insertSecondarySmtpCredential(): Promise<void> {
  await sql`
    INSERT INTO credential_refs (scope, owner_id, label, secret_store, secret_ref, status)
    VALUES ('smtp', 'secondary', 'Secondary SMTP Password', 'encrypted_db', ${secondarySecretRef}, 'configured')
    ON CONFLICT DO NOTHING
  `;
}

async function cleanup() {
  await sql`DELETE FROM export_targets WHERE organization_id = ${ORG}`;
  await sql`DELETE FROM credential_refs WHERE secret_ref = ${secondarySecretRef}`;
  await sql`DELETE FROM settings WHERE key = 'smtp_accounts'`;
  await sql`DELETE FROM organizations WHERE id = ${ORG}`;
  await sql`DELETE FROM users WHERE id = ${USER}`;
}

describe.skipIf(!hasDb)("2. Absende-Konto löschen", () => {
  beforeEach(async () => {
    await cleanup();
    await sql`INSERT INTO users (id, email, name) VALUES (${USER}, ${`${USER}@infetch.local`}, 'Del') ON CONFLICT DO NOTHING`;
    await sql`
      INSERT INTO organizations (id, name, slug, tier, owner_user_id)
      VALUES (${ORG}, 'SMTP Del', ${ORG}, 'free', ${USER})
      ON CONFLICT DO NOTHING
    `;
  });
  afterEach(cleanup);

  it("setzt Empfänger von Konto 2 auf Konto 1 zurück, lässt Konto-1-Empfänger unberührt", async () => {
    await insertTarget("kontist", "secondary");
    await insertTarget("accountable", "primary");

    await deleteSmtpAccountAction(fd({ mailSlot: "secondary" }));

    expect(await smtpSlotFor("kontist")).toBe("primary");
    expect(await smtpSlotFor("accountable")).toBe("primary");
  });

  it("entfernt das gespeicherte Konto und das Credential von Konto 2", async () => {
    await saveStoredSmtpAccount(
      "secondary",
      {
        host: "smtp.example.com",
        port: 587,
        secure: false,
        username: "zweit@example.com",
        fromAddress: "zweit@example.com",
      },
      ORG,
    );
    await insertSecondarySmtpCredential();
    expect(await getStoredSmtpAccount("secondary", ORG)).toBeDefined();
    expect(await hasStoredCredentialRef("smtp", "secondary", ORG)).toBe(true);

    await deleteSmtpAccountAction(fd({ mailSlot: "secondary" }));

    expect(await getStoredSmtpAccount("secondary", ORG)).toBeUndefined();
    expect(await hasStoredCredentialRef("smtp", "secondary", ORG)).toBe(false);
  });

  it("schützt Konto 1: mailSlot=primary ist ein No-op", async () => {
    await insertTarget("kontist", "secondary");
    await insertSecondarySmtpCredential();

    await deleteSmtpAccountAction(fd({ mailSlot: "primary" }));

    expect(await smtpSlotFor("kontist")).toBe("secondary");
    expect(await hasStoredCredentialRef("smtp", "secondary", ORG)).toBe(true);
  });
});
