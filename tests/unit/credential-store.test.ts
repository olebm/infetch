import Database from "better-sqlite3";
import { describe, expect, it } from "vitest";
import { buildSecretRef, hasConfiguredCredential, maskIdentifier } from "@/lib/secrets/credential-store";
import { schemaStatements } from "@/lib/db/schema";

function createDb() {
  const db = new Database(":memory:");
  db.pragma("foreign_keys = ON");
  for (const statement of schemaStatements) {
    db.exec(statement);
  }
  return db;
}

describe("credential store metadata", () => {
  it("builds stable secret refs without leaking owner identifiers", () => {
    const ref = buildSecretRef("imap", "rechnung@example.com");

    expect(ref).toBe(buildSecretRef("imap", "rechnung@example.com"));
    expect(ref).toMatch(/^invoice-agent:imap:[a-f0-9]{16}$/);
    expect(ref).not.toContain("rechnung");
    expect(ref).not.toContain("example.com");
  });

  it("masks visible identifiers", () => {
    expect(maskIdentifier("rechnung@example.com")).toBe("re***@example.com");
    expect(maskIdentifier("abcdef")).toBe("ab***ef");
  });

  it("detects configured credential refs without reading the secret", () => {
    const db = createDb();
    const secretRef = buildSecretRef("imap", "primary");

    db.prepare(
      `INSERT INTO credential_refs (scope, owner_id, label, secret_store, secret_ref, status)
       VALUES ('imap', 'primary', 'Primary IMAP Password', 'os_keychain', ?, 'configured')`,
    ).run(secretRef);

    expect(hasConfiguredCredential(db, "imap", "primary")).toBe(true);
    expect(hasConfiguredCredential(db, "smtp", "primary")).toBe(false);
  });
});
