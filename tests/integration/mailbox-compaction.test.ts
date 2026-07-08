import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { sql } from "@/lib/db/client";
import { createScopedSql } from "@/lib/db/scoped-query";
import {
  saveCredentialSecret,
  readCredentialSecret,
  hasStoredCredentialRef,
} from "@/lib/secrets/credential-store";

// Verifiziert die Slot-Compaction beim Entfernen des 2. Empfangs-Postfachs:
// ein vorhandenes 3. Postfach rückt lückenlos auf "secondary" nach — inkl.
// des verschlüsselten Credentials (das umgezogen, nicht verwaist wird).

const SUFFIX = `${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
const ORG = `org-imap-compact-${SUFFIX}`;
const USER = `user-imap-compact-${SUFFIX}`;
const hasDb = Boolean(process.env.DATABASE_URL);

vi.mock("@/lib/auth/current", () => {
  const auth = () => ({
    session: {},
    user: { id: USER },
    organization: { id: ORG, name: "Compact", slug: ORG, tier: "free", ownerUserId: USER },
    scopedSql: createScopedSql(ORG),
  });
  return { getCurrentAuth: async () => auth(), requireCurrentAuth: async () => auth() };
});
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));

import { deleteImapAccountAction } from "@/app/(app)/einstellungen/actions";

function fd(fields: Record<string, string>): FormData {
  const f = new FormData();
  for (const [k, v] of Object.entries(fields)) f.set(k, v);
  return f;
}

async function insertMailAccount(label: string, username: string): Promise<void> {
  await sql`
    INSERT INTO mail_accounts (label, host, port, secure, username, status, organization_id)
    VALUES (${label}, 'imap.compact.test', 993, true, ${username}, 'configured', ${ORG})
  `;
}

async function labelFor(username: string): Promise<string | null> {
  const rows = await sql<{ label: string }[]>`
    SELECT label FROM mail_accounts WHERE organization_id = ${ORG} AND username = ${username} LIMIT 1
  `;
  return rows[0]?.label ?? null;
}

async function cleanup() {
  await sql`DELETE FROM mail_messages WHERE mail_account_id IN (
    SELECT id FROM mail_accounts WHERE organization_id = ${ORG}
  )`;
  await sql`DELETE FROM mail_accounts WHERE organization_id = ${ORG}`;
  await sql`DELETE FROM credential_refs WHERE organization_id = ${ORG}`;
  await sql`DELETE FROM organizations WHERE id = ${ORG}`;
  await sql`DELETE FROM users WHERE id = ${USER}`;
}

describe.skipIf(!hasDb)("Postfach-Slots kompaktieren", () => {
  beforeEach(async () => {
    await cleanup();
    await sql`INSERT INTO users (id, email, name) VALUES (${USER}, ${`${USER}@infetch.local`}, 'C') ON CONFLICT DO NOTHING`;
    await sql`
      INSERT INTO organizations (id, name, slug, tier, owner_user_id)
      VALUES (${ORG}, 'Compact', ${ORG}, 'free', ${USER})
      ON CONFLICT DO NOTHING
    `;
  });
  afterEach(cleanup);

  it("beim Entfernen von secondary rückt tertiary nach — Slot + Credential wandern mit", async () => {
    await insertMailAccount("Primary IMAP", "primary@example.com");
    await insertMailAccount("Secondary IMAP", "secondary@example.com");
    await insertMailAccount("Tertiary IMAP", "tertiary@example.com");
    await saveCredentialSecret({
      scope: "imap",
      ownerId: "secondary",
      organizationId: ORG,
      label: "Secondary IMAP Password",
      secret: "sec-pw",
    });
    await saveCredentialSecret({
      scope: "imap",
      ownerId: "tertiary",
      organizationId: ORG,
      label: "Tertiary IMAP Password",
      secret: "ter-pw",
    });

    await deleteImapAccountAction(fd({ mailSlot: "secondary" }));

    // Das dritte Postfach ist jetzt das zweite (label folgt dem physischen Postfach).
    expect(await labelFor("tertiary@example.com")).toBe("Secondary IMAP");
    // Das alte zweite Postfach ist entfernt.
    expect(await labelFor("secondary@example.com")).toBeNull();
    // Der tertiäre Slot ist frei (keine Lücke, aber der 3. Platz ist leer).
    const tertiary = await sql<{ count: string }[]>`
      SELECT COUNT(*) AS count FROM mail_accounts
      WHERE organization_id = ${ORG} AND label = 'Tertiary IMAP'
    `;
    expect(Number(tertiary[0].count)).toBe(0);
    // Der springende Punkt: das Credential des 3. Postfachs ist jetzt unter
    // "secondary" lesbar (umgezogen, nicht verwaist), das alte tertiäre weg.
    expect(
      await readCredentialSecret({ scope: "imap", ownerId: "secondary", organizationId: ORG }),
    ).toBe("ter-pw");
    expect(await hasStoredCredentialRef("imap", "tertiary", ORG)).toBe(false);
  });

  it("ohne drittes Postfach bleibt es beim einfachen Entfernen (kein Nachrücken)", async () => {
    await insertMailAccount("Primary IMAP", "primary@example.com");
    await insertMailAccount("Secondary IMAP", "secondary@example.com");

    await deleteImapAccountAction(fd({ mailSlot: "secondary" }));

    expect(await labelFor("secondary@example.com")).toBeNull();
    expect(await labelFor("primary@example.com")).toBe("Primary IMAP");
  });

  it("schützt das primäre Postfach: mailSlot=primary ist ein No-op", async () => {
    await insertMailAccount("Primary IMAP", "primary@example.com");

    await deleteImapAccountAction(fd({ mailSlot: "primary" }));

    expect(await labelFor("primary@example.com")).toBe("Primary IMAP");
  });
});
