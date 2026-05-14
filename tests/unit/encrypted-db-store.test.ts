import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { sql } from "@/lib/db/client";
import { deleteDbSecret, isDbStoreAvailable, readDbSecret, writeDbSecret } from "@/lib/secrets/encrypted-db-store";

// NOTE: These tests use the global postgres sql client.
// They require a real Postgres connection (DATABASE_URL env var).

const TEST_KEY = "0".repeat(64); // 32 zero-bytes as hex
const TEST_PREFIX = `test:enc:${Date.now()}:`;

async function cleanupTestSecrets() {
  // Clean up any test secrets we may have written
  await sql`DELETE FROM encrypted_secrets WHERE secret_ref LIKE ${TEST_PREFIX + "%"}`;
}

// ─── isDbStoreAvailable ───────────────────────────────────────────────────────

describe("isDbStoreAvailable", () => {
  const orig = process.env.SECRET_ENCRYPTION_KEY;

  afterEach(() => {
    if (orig === undefined) delete process.env.SECRET_ENCRYPTION_KEY;
    else process.env.SECRET_ENCRYPTION_KEY = orig;
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
  beforeEach(async () => {
    process.env.SECRET_ENCRYPTION_KEY = TEST_KEY;
    await cleanupTestSecrets();
  });

  afterEach(async () => {
    await cleanupTestSecrets();
    delete process.env.SECRET_ENCRYPTION_KEY;
  });

  it("stores and retrieves a secret", async () => {
    await writeDbSecret(`${TEST_PREFIX}1`, "super-secret");
    expect(await readDbSecret(`${TEST_PREFIX}1`)).toBe("super-secret");
  });

  it("handles secrets with special characters", async () => {
    const secret = 'p@$$w0rd!"#%&/()=?€üöä';
    await writeDbSecret(`${TEST_PREFIX}special`, secret);
    expect(await readDbSecret(`${TEST_PREFIX}special`)).toBe(secret);
  });

  it("overwrites an existing entry on re-write", async () => {
    await writeDbSecret(`${TEST_PREFIX}overwrite`, "old-secret");
    await writeDbSecret(`${TEST_PREFIX}overwrite`, "new-secret");
    expect(await readDbSecret(`${TEST_PREFIX}overwrite`)).toBe("new-secret");
  });

  it("each write produces a different ciphertext (random IV)", async () => {
    const ref = `${TEST_PREFIX}iv1`;
    await writeDbSecret(ref, "same-secret");
    const rows1 = await sql<{ ciphertext: string }[]>`SELECT ciphertext FROM encrypted_secrets WHERE secret_ref = ${ref}`;
    const ct1 = rows1[0].ciphertext;

    await writeDbSecret(ref, "same-secret");
    const rows2 = await sql<{ ciphertext: string }[]>`SELECT ciphertext FROM encrypted_secrets WHERE secret_ref = ${ref}`;
    const ct2 = rows2[0].ciphertext;

    expect(ct1).not.toBe(ct2); // different IV → different ciphertext
  });

  it("returns null for unknown secretRef", async () => {
    expect(await readDbSecret(`${TEST_PREFIX}not-found`)).toBeNull();
  });

  it("returns null when key is missing at read time", async () => {
    await writeDbSecret(`${TEST_PREFIX}nokey`, "secret");
    delete process.env.SECRET_ENCRYPTION_KEY;
    expect(await readDbSecret(`${TEST_PREFIX}nokey`)).toBeNull();
  });

  it("returns null when key changes (wrong key → auth tag mismatch)", async () => {
    await writeDbSecret(`${TEST_PREFIX}wrongkey`, "secret");
    process.env.SECRET_ENCRYPTION_KEY = "f".repeat(64); // different key
    expect(await readDbSecret(`${TEST_PREFIX}wrongkey`)).toBeNull();
  });

  it("returns null when ciphertext is tampered", async () => {
    const ref = `${TEST_PREFIX}tampered`;
    await writeDbSecret(ref, "secret");
    const rows = await sql<{ ciphertext: string }[]>`SELECT ciphertext FROM encrypted_secrets WHERE secret_ref = ${ref}`;
    const tampered = rows[0].ciphertext.slice(0, -1) + (rows[0].ciphertext.endsWith("a") ? "b" : "a");
    await sql`UPDATE encrypted_secrets SET ciphertext = ${tampered} WHERE secret_ref = ${ref}`;
    expect(await readDbSecret(ref)).toBeNull();
  });
});

// ─── deleteDbSecret ───────────────────────────────────────────────────────────

describe("deleteDbSecret", () => {
  beforeEach(async () => {
    process.env.SECRET_ENCRYPTION_KEY = TEST_KEY;
    await cleanupTestSecrets();
  });

  afterEach(async () => {
    await cleanupTestSecrets();
    delete process.env.SECRET_ENCRYPTION_KEY;
  });

  it("removes an existing entry", async () => {
    await writeDbSecret(`${TEST_PREFIX}del:1`, "secret");
    await deleteDbSecret(`${TEST_PREFIX}del:1`);
    expect(await readDbSecret(`${TEST_PREFIX}del:1`)).toBeNull();
  });

  it("is a no-op when entry does not exist", async () => {
    await expect(deleteDbSecret(`${TEST_PREFIX}del:nonexistent`)).resolves.not.toThrow();
  });
});

// ─── Key-Format Validation ────────────────────────────────────────────────────

describe("key validation", () => {
  afterEach(() => {
    delete process.env.SECRET_ENCRYPTION_KEY;
  });

  it("throws when key is too short", async () => {
    process.env.SECRET_ENCRYPTION_KEY = "deadbeef"; // 4 bytes, not 32
    await expect(writeDbSecret(`${TEST_PREFIX}bad:key`, "secret")).rejects.toThrow(/32 Bytes/);
  });

  it("throws when key is not configured", async () => {
    delete process.env.SECRET_ENCRYPTION_KEY;
    await expect(writeDbSecret(`${TEST_PREFIX}bad:noenv`, "secret")).rejects.toThrow(/SECRET_ENCRYPTION_KEY/);
  });
});
