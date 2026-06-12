import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { sql } from "@/lib/db/client";
import {
  getStoredSmtpAccount,
  saveStoredSmtpAccount,
  removeStoredSmtpAccount,
} from "@/mail/smtp-settings";

// INFETCH-280: SMTP-Absende-Konten müssen pro Org isoliert sein. Vorher EIN
// globaler Key — eine Org überschrieb das Primary-Konto (Host/From) einer
// anderen → Versand über den falschen Server.

const hasDb = Boolean(process.env.DATABASE_URL);
const SUFFIX = `${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
const ORG_A = `smtp-a-${SUFFIX}`;
const ORG_B = `smtp-b-${SUFFIX}`;

const accountA = {
  host: "smtp.org-a.de",
  port: 587,
  secure: false,
  username: "a@org-a.de",
  fromAddress: "a@org-a.de",
};
const accountB = {
  host: "smtp.org-b.de",
  port: 465,
  secure: true,
  username: "b@org-b.de",
  fromAddress: "b@org-b.de",
};

async function cleanup() {
  await sql`DELETE FROM settings WHERE key IN (${`smtp_accounts:${ORG_A}`}, ${`smtp_accounts:${ORG_B}`})`;
}

describe.skipIf(!hasDb)("smtp accounts — per-org isolation (INFETCH-280)", () => {
  beforeEach(cleanup);
  afterEach(cleanup);

  it("zwei Orgs überschreiben sich ihr Primary-Konto NICHT", async () => {
    await saveStoredSmtpAccount("primary", accountA, ORG_A);
    await saveStoredSmtpAccount("primary", accountB, ORG_B);

    const a = await getStoredSmtpAccount("primary", ORG_A);
    const b = await getStoredSmtpAccount("primary", ORG_B);
    expect(a?.host).toBe("smtp.org-a.de");
    expect(b?.host).toBe("smtp.org-b.de");
    // Kein Bleed: B's Speichern hat A nicht verändert.
    expect(a?.fromAddress).toBe("a@org-a.de");
  });

  it("Schreiben trifft nur den org-gescopten Key, nicht global", async () => {
    await saveStoredSmtpAccount("primary", accountA, ORG_A);

    const scoped = await sql<{ valueJson: string }[]>`
      SELECT value_json AS "valueJson" FROM settings WHERE key = ${`smtp_accounts:${ORG_A}`} LIMIT 1
    `;
    expect(scoped[0]?.valueJson).toContain("smtp.org-a.de");

    // Falls ein Legacy-Global existiert, darf es A's Host NICHT enthalten.
    const globalRows = await sql<{ valueJson: string }[]>`
      SELECT value_json AS "valueJson" FROM settings WHERE key = 'smtp_accounts' LIMIT 1
    `;
    if (globalRows[0]?.valueJson) {
      expect(globalRows[0].valueJson).not.toContain("smtp.org-a.de");
    }
  });

  it("removeStoredSmtpAccount entfernt nur in der eigenen Org", async () => {
    await saveStoredSmtpAccount("secondary", accountA, ORG_A);
    await saveStoredSmtpAccount("secondary", accountB, ORG_B);

    await removeStoredSmtpAccount("secondary", ORG_A);

    expect(await getStoredSmtpAccount("secondary", ORG_A)).toBeUndefined();
    // B's Secondary bleibt unberührt.
    expect((await getStoredSmtpAccount("secondary", ORG_B))?.host).toBe("smtp.org-b.de");
  });
});
