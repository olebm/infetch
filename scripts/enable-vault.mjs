#!/usr/bin/env node
/**
 * Aktiviert Supabase Vault (pgsodium Extension) im Supabase-Projekt.
 * Muss einmalig ausgeführt werden bevor Credentials gespeichert werden können.
 * Usage: node scripts/enable-vault.mjs
 */
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

// .env.local laden wenn DATABASE_URL nicht gesetzt
if (!process.env.DATABASE_URL) {
  const envPath = join(dirname(fileURLToPath(import.meta.url)), "../.env.local");
  try {
    for (const line of readFileSync(envPath, "utf8").split("\n")) {
      const m = line.match(/^([A-Z_][A-Z0-9_]*)=(.+)$/);
      if (m && !process.env[m[1]]) process.env[m[1]] = m[2].trim();
    }
  } catch {
    /* .env.local not found */
  }
}

const require = createRequire(import.meta.url);
const postgres = require("postgres");

const url = process.env.DATABASE_URL;
if (!url || !url.startsWith("postgresql")) {
  console.error("❌ DATABASE_URL nicht gesetzt oder kein Postgres-URL");
  process.exit(1);
}

const sql = postgres(url, { prepare: false });

console.log("Aktiviere Supabase Vault (pgsodium) …");
try {
  await sql`CREATE EXTENSION IF NOT EXISTS supabase_vault CASCADE`;
  console.log("✅ Vault-Extension aktiviert");

  // Kurzer Smoke-Test: ein Secret anlegen, lesen, löschen
  const testRef = `__vault_test_${Date.now()}`;
  await sql`SELECT vault.create_secret(${"smoke-test-value"}, ${testRef})`;
  const rows = await sql`
    SELECT decrypted_secret AS val
    FROM vault.decrypted_secrets
    WHERE name = ${testRef}
    LIMIT 1
  `;
  await sql`DELETE FROM vault.secrets WHERE name = ${testRef}`;

  if (rows[0]?.val === "smoke-test-value") {
    console.log("✅ Vault Smoke-Test bestanden — Lesen/Schreiben/Löschen funktioniert");
  } else {
    console.error("❌ Vault Smoke-Test fehlgeschlagen — unerwarteter Rückgabewert:", rows[0]);
    process.exit(1);
  }
} catch (err) {
  console.error("❌ Vault-Aktivierung fehlgeschlagen:", err.message);
  process.exit(1);
} finally {
  await sql.end();
}

console.log("Done.");
