import Database from "better-sqlite3";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { deleteDbSecret, isDbStoreAvailable, readDbSecret, writeDbSecret } from "@/lib/secrets/encrypted-db-store";
import { schemaStatements } from "@/lib/db/schema";

// ─── Test-DB ──────────────────────────────────────────────────────────────────

function createTestDb(): Database.Database {
  const db = new Database(":memory:");
  db.pragma("foreign_keys = ON");
  for (const statement of schemaStatements) {
    try {
      db.exec(statement);
    } catch (err) {
      const isAlterDupe =
        /^\s*ALTER\s+TABLE\s+\S+\s+ADD\s+COLUMN\s+/i.test(statement) &&
        err instanceof Error &&
        err.message.includes("duplicate column name");
      if (!isAlterDupe) throw err;
    }
  }
  return db;
}

// ─── isDbStoreAvailable ───────────────────────────────────────────────────────

describe("isDbStoreAvailable", () => {
  afterEach(() => {
    delete process.env.SECRET_ENCRYPTION_KEY;
  });

  it("returns false when env var is missing", () => {
    delete process.env.SECRET_ENCRYPTION_KEY;
    expect(isDbStoreAvailable()).toBe(false);
  });

  it("returns false when env var is empty string", () => {
    process.env.SECRET_ENCRYPTION_KEY = "   ";
    expect(isDbStoreAvailable()).toBe(false);
  });

  it("returns true when env var is set", () => {
    process.env.SECRET_ENCRYPTION_KEY = "a".repeat(64);
    expect(isDbStoreAvailable()).toBe(true);
  });
});

// ─── Round-trip encrypt / decrypt ─────────────────────────────────────────────

describe("writeDbSecret / readDbSecret", () => {
  const VALID_KEY = "0".repeat(64); // 32 zero-bytes as hex
  let db: Database.Database;

  beforeEach(() => {
    db = createTestDb();
    process.env.SECRET_ENCRYPTION_KEY = VALID_KEY;
  });

  afterEach(() => {
    delete process.env.SECRET_ENCRYPTION_KEY;
    db.close();
  });

  it("stores and retrieves a secret", () => {
    writeDbSecret("ref:test:1", "super-secret", db);
    expect(readDbSecret("ref:test:1", db)).toBe("super-secret");
  });

  it("handles secrets with special characters", () => {
    const secret = 'p@$$w0rd!"#%&/()=?€üöä';
    writeDbSecret("ref:test:special", secret, db);
    expect(readDbSecret("ref:test:special", db)).toBe(secret);
  });

  it("overwrites an existing entry on re-write", () => {
    writeDbSecret("ref:test:overwrite", "old-secret", db);
    writeDbSecret("ref:test:overwrite", "new-secret", db);
    expect(readDbSecret("ref:test:overwrite", db)).toBe("new-secret");
  });

  it("each write produces a different ciphertext (random IV)", () => {
    writeDbSecret("ref:test:iv1", "same-secret", db);
    const ct1 = (db.prepare("SELECT ciphertext FROM encrypted_secrets WHERE secret_ref = ?").get("ref:test:iv1") as { ciphertext: string }).ciphertext;

    writeDbSecret("ref:test:iv1", "same-secret", db);
    const ct2 = (db.prepare("SELECT ciphertext FROM encrypted_secrets WHERE secret_ref = ?").get("ref:test:iv1") as { ciphertext: string }).ciphertext;

    expect(ct1).not.toBe(ct2); // different IV → different ciphertext
  });

  it("returns null for unknown secretRef", () => {
    expect(readDbSecret("ref:not:found", db)).toBeNull();
  });

  it("returns null when key is missing at read time", () => {
    writeDbSecret("ref:test:nokey", "secret", db);
    delete process.env.SECRET_ENCRYPTION_KEY;
    expect(readDbSecret("ref:test:nokey", db)).toBeNull();
  });

  it("returns null when key changes (wrong key → auth tag mismatch)", () => {
    writeDbSecret("ref:test:wrongkey", "secret", db);
    process.env.SECRET_ENCRYPTION_KEY = "f".repeat(64); // different key
    expect(readDbSecret("ref:test:wrongkey", db)).toBeNull();
  });

  it("returns null when ciphertext is tampered", () => {
    writeDbSecret("ref:test:tampered", "secret", db);
    // Flip the last hex char of the stored ciphertext
    const row = db.prepare("SELECT ciphertext FROM encrypted_secrets WHERE secret_ref = ?").get("ref:test:tampered") as { ciphertext: string };
    const tampered = row.ciphertext.slice(0, -1) + (row.ciphertext.endsWith("a") ? "b" : "a");
    db.prepare("UPDATE encrypted_secrets SET ciphertext = ? WHERE secret_ref = ?").run(tampered, "ref:test:tampered");
    expect(readDbSecret("ref:test:tampered", db)).toBeNull();
  });
});

// ─── deleteDbSecret ───────────────────────────────────────────────────────────

describe("deleteDbSecret", () => {
  const VALID_KEY = "0".repeat(64);
  let db: Database.Database;

  beforeEach(() => {
    db = createTestDb();
    process.env.SECRET_ENCRYPTION_KEY = VALID_KEY;
  });

  afterEach(() => {
    delete process.env.SECRET_ENCRYPTION_KEY;
    db.close();
  });

  it("removes an existing entry", () => {
    writeDbSecret("ref:delete:1", "secret", db);
    deleteDbSecret("ref:delete:1", db);
    expect(readDbSecret("ref:delete:1", db)).toBeNull();
  });

  it("is a no-op when entry does not exist", () => {
    expect(() => deleteDbSecret("ref:delete:nonexistent", db)).not.toThrow();
  });
});

// ─── Key-Format Validation ────────────────────────────────────────────────────

describe("key validation", () => {
  let db: Database.Database;

  beforeEach(() => { db = createTestDb(); });
  afterEach(() => {
    delete process.env.SECRET_ENCRYPTION_KEY;
    db.close();
  });

  it("throws when key is too short", () => {
    process.env.SECRET_ENCRYPTION_KEY = "deadbeef"; // 4 bytes, not 32
    expect(() => writeDbSecret("ref:bad:key", "secret", db)).toThrow(/32 Bytes/);
  });

  it("throws when key is not configured", () => {
    delete process.env.SECRET_ENCRYPTION_KEY;
    expect(() => writeDbSecret("ref:bad:noenv", "secret", db)).toThrow(/SECRET_ENCRYPTION_KEY/);
  });
});
