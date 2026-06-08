import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { sql } from "@/lib/db/client";
import { buildSecretRef } from "@/lib/secrets/credential-store";
import { getStoredSmtpAccount } from "@/mail/smtp-settings";

// Incident (webgo): ältere Postfächer verlangen einen Postfach-Namen (web000p1)
// als Login statt der E-Mail. Verifiziert, dass ein abweichender Benutzername
// getrennt von der Absende-Adresse (fromAddress) gespeichert wird.

const SUFFIX = `${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
const ORG = `org-smtp-user-${SUFFIX}`;
const USER = `user-smtp-user-${SUFFIX}`;
const hasDb = Boolean(process.env.DATABASE_URL);

vi.mock("@/lib/auth/current", () => {
  const auth = () => ({
    session: {},
    user: { id: USER },
    organization: { id: ORG, name: "SMTP User", slug: ORG, tier: "free", ownerUserId: USER },
  });
  return { getCurrentAuth: async () => auth(), requireCurrentAuth: async () => auth() };
});
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));

import { saveSmtpMailboxAction } from "@/app/(app)/einstellungen/actions";

function fd(fields: Record<string, string>): FormData {
  const f = new FormData();
  for (const [k, v] of Object.entries(fields)) f.set(k, v);
  return f;
}

const primarySecretRef = buildSecretRef("smtp", "primary", ORG);

async function cleanup() {
  await sql`DELETE FROM credential_refs WHERE secret_ref = ${primarySecretRef}`;
  await sql`DELETE FROM settings WHERE key = 'smtp_accounts'`;
  await sql`DELETE FROM organizations WHERE id = ${ORG}`;
  await sql`DELETE FROM users WHERE id = ${USER}`;
}

describe.skipIf(!hasDb)("SMTP abweichender Benutzername (webgo-Postfachname)", () => {
  beforeEach(async () => {
    await cleanup();
    await sql`INSERT INTO users (id, email, name) VALUES (${USER}, ${`${USER}@infetch.local`}, 'U') ON CONFLICT DO NOTHING`;
    await sql`
      INSERT INTO organizations (id, name, slug, tier, owner_user_id)
      VALUES (${ORG}, 'SMTP User', ${ORG}, 'free', ${USER})
      ON CONFLICT DO NOTHING
    `;
    // Credential vorab anlegen → persistSmtpAccount läuft ohne Passwort/Keychain durch.
    await sql`
      INSERT INTO credential_refs (scope, owner_id, label, secret_store, secret_ref, status)
      VALUES ('smtp', 'primary', 'Primary SMTP', 'encrypted_db', ${primarySecretRef}, 'configured')
      ON CONFLICT DO NOTHING
    `;
  });
  afterEach(cleanup);

  it("speichert den Postfach-Namen als username, die E-Mail als fromAddress", async () => {
    const result = await saveSmtpMailboxAction(
      { status: "idle", message: "" },
      fd({
        mailSlot: "primary",
        smtpEmail: "tools@ole-beekmann.de",
        smtpUsername: "web000p1",
        smtpHost: "s181.goserver.host",
        smtpPort: "587",
        smtpSecure: "false",
      }),
    );
    expect(result.status).toBe("success");
    const acc = await getStoredSmtpAccount("primary");
    expect(acc?.username).toBe("web000p1");
    expect(acc?.fromAddress).toBe("tools@ole-beekmann.de");
  });

  it("ohne abweichenden Benutzernamen: username = E-Mail", async () => {
    await saveSmtpMailboxAction(
      { status: "idle", message: "" },
      fd({
        mailSlot: "primary",
        smtpEmail: "tools@ole-beekmann.de",
        smtpUsername: "",
        smtpHost: "s181.goserver.host",
        smtpPort: "587",
        smtpSecure: "false",
      }),
    );
    const acc = await getStoredSmtpAccount("primary");
    expect(acc?.username).toBe("tools@ole-beekmann.de");
    expect(acc?.fromAddress).toBe("tools@ole-beekmann.de");
  });
});
