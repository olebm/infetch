#!/usr/bin/env node
/**
 * Applies a Supabase migration SQL file to the Postgres DB.
 * Usage: node scripts/apply-migration.mjs [migration-file]
 *   Default: supabase/migrations/0001_initial_schema.sql
 *   Example: node scripts/apply-migration.mjs supabase/migrations/0010_rls.sql
 */
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { dirname, join, resolve } from "node:path";

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

const arg = process.argv[2];
const migrationPath = arg
  ? resolve(arg)
  : join(dirname(fileURLToPath(import.meta.url)), "../supabase/migrations/0001_initial_schema.sql");

const migrationName = migrationPath.split("/").pop();
const migrationSql = readFileSync(migrationPath, "utf8");

console.log(`Applying ${migrationName} …`);
try {
  await sql.unsafe(migrationSql);
  console.log(`✅ ${migrationName} applied successfully`);
} catch (err) {
  console.error(`❌ Migration failed:`, err.message);
  process.exit(1);
} finally {
  await sql.end();
}
