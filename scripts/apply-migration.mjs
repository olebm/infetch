#!/usr/bin/env node
/**
 * Applies supabase/migrations/0001_initial_schema.sql to the Postgres DB.
 * Usage: DATABASE_URL=... node scripts/apply-migration.mjs
 *   or:  node scripts/apply-migration.mjs  (picks up .env.local automatically)
 */
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

// Load .env.local manually if DATABASE_URL not set
if (!process.env.DATABASE_URL) {
  const envPath = join(dirname(fileURLToPath(import.meta.url)), "../.env.local");
  try {
    const env = readFileSync(envPath, "utf8");
    for (const line of env.split("\n")) {
      const m = line.match(/^([A-Z_]+)=(.+)$/);
      if (m && !process.env[m[1]]) process.env[m[1]] = m[2].trim();
    }
  } catch { /* .env.local not found */ }
}

const require = createRequire(import.meta.url);
const postgres = require("postgres");

const url = process.env.DATABASE_URL;
if (!url || !url.startsWith("postgresql")) {
  console.error("❌ DATABASE_URL not set or not a postgres URL");
  process.exit(1);
}

const sql = postgres(url, { prepare: false });
const migrationPath = join(
  dirname(fileURLToPath(import.meta.url)),
  "../supabase/migrations/0001_initial_schema.sql",
);
const migrationSql = readFileSync(migrationPath, "utf8");

console.log("Applying migration 0001_initial_schema.sql …");
try {
  await sql.unsafe(migrationSql);
  console.log("✅ Migration applied successfully");
} catch (err) {
  console.error("❌ Migration failed:", err.message);
  process.exit(1);
} finally {
  await sql.end();
}
