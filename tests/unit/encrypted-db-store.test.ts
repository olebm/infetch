import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { sql } from "@/lib/db/client";
import { deleteDbSecret, isDbStoreAvailable, readDbSecret, writeDbSecret } from "@/lib/secrets/encrypted-db-store";

// NOTE: These tests exercise the Supabase Vault implementation of encrypted-db-store.
// The implementation delegates all encryption to vault.create_secret / vault.decrypted_secrets.
// CI runs against a plain-postgres vault stub (no pgsodium) — secrets are stored as-is there.
// Production uses real Supabase Vault with pgsodium encryption.
// These tests require a real Postgres connection (DATABASE_URL env var).

const TEST_PREFIX = `test:vault:${Date.now()}:`;

async function cleanupTestSecrets() {
  await sql`DELETE FROM vault.secrets WHERE name LIKE ${TEST_PREFIX + "%"}`;
}

// ─── isDbStoreAvailable ───────────────────────────────────────────────────────

describe("isDbStoreAvailable", () => {
  it("always returns true — Supabase Vault is always active on Supabase", () => {
    expect(isDbStoreAvailable()).toBe(true);
  });
});

// ─── Round-trip write / read ──────────────────────────────────────────────────

describe("writeDbSecret / readDbSecret", () => {
  beforeEach(async () => { await cleanupTestSecrets(); });
  afterEach(async ()  => { await cleanupTestSecrets(); });

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

  it("returns null for unknown secretRef", async () => {
    expect(await readDbSecret(`${TEST_PREFIX}not-found`)).toBeNull();
  });
});

// ─── deleteDbSecret ───────────────────────────────────────────────────────────

describe("deleteDbSecret", () => {
  beforeEach(async () => { await cleanupTestSecrets(); });
  afterEach(async ()  => { await cleanupTestSecrets(); });

  it("removes an existing entry", async () => {
    await writeDbSecret(`${TEST_PREFIX}del:1`, "secret");
    await deleteDbSecret(`${TEST_PREFIX}del:1`);
    expect(await readDbSecret(`${TEST_PREFIX}del:1`)).toBeNull();
  });

  it("is a no-op when entry does not exist", async () => {
    await expect(deleteDbSecret(`${TEST_PREFIX}del:nonexistent`)).resolves.not.toThrow();
  });
});
