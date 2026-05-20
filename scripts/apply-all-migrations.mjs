#!/usr/bin/env node
/**
 * Linear migration runner — applies all .sql files in supabase/migrations/
 * in lexical order, tracking applied versions in public.schema_migrations.
 *
 * Replaces:
 *  - .github/workflows/ci.yml lines 85–214 (cherry-picked psql + inline ALTER)
 *  - scripts/ci/reconcile-schema.sql (CI patch block)
 *  - scripts/apply-migration.mjs (legacy single-file runner)
 *
 * Usage:
 *   node scripts/apply-all-migrations.mjs <DATABASE_URL> [options]
 *
 * Options:
 *   --up-to=NNNN              Stop after migration NNNN (inclusive). Example: --up-to=0018
 *   --set key=value           Set a GUC before applying. Repeatable. Example: --set app.designated_org=<uuid>
 *   --snapshot-mode=MODE      ci-fresh (default) | prod-replay
 *                             prod-replay assumes tests/fixtures/pre-0019-snapshot.sql was loaded first
 *                             and that schema_migrations should be backfilled accordingly.
 *
 * Exit codes:
 *   0  all migrations applied (or already up-to-date)
 *   1  validation / argv error
 *   2  migration failure (aborts on first error, transactionally)
 */
import { readFileSync, readdirSync } from "node:fs";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const require = createRequire(import.meta.url);

// ───────────────────── Pure helpers (exported for tests) ─────────────────────

export function parseArgs(argv) {
  const out = {
    databaseUrl: null,
    upTo: null,
    skip: [],
    sets: [],
    snapshotMode: "ci-fresh",
    migrationsDir: null,
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith("--up-to=")) out.upTo = a.slice("--up-to=".length);
    else if (a === "--up-to") out.upTo = argv[++i];
    else if (a.startsWith("--skip=")) out.skip.push(a.slice("--skip=".length));
    else if (a === "--skip") out.skip.push(argv[++i]);
    else if (a.startsWith("--set=")) out.sets.push(a.slice("--set=".length));
    else if (a === "--set") out.sets.push(argv[++i]);
    else if (a.startsWith("--snapshot-mode=")) out.snapshotMode = a.slice("--snapshot-mode=".length);
    else if (a === "--snapshot-mode") out.snapshotMode = argv[++i];
    else if (a.startsWith("--migrations-dir=")) out.migrationsDir = a.slice("--migrations-dir=".length);
    else if (a === "--migrations-dir") out.migrationsDir = argv[++i];
    else if (a.startsWith("postgres://") || a.startsWith("postgresql://")) out.databaseUrl = a;
    else if (a === "--help" || a === "-h") out.help = true;
    else throw new Error(`Unknown argument: ${a}`);
  }
  if (!["ci-fresh", "prod-replay"].includes(out.snapshotMode)) {
    throw new Error(`Invalid --snapshot-mode: ${out.snapshotMode} (must be ci-fresh or prod-replay)`);
  }
  for (const s of out.sets) {
    if (!s.includes("=")) throw new Error(`Invalid --set value (expected key=value): ${s}`);
  }
  return out;
}

export function extractVersion(filename) {
  const m = filename.match(/^(\d+)_/);
  if (!m) throw new Error(`Cannot extract version from migration filename: ${filename}`);
  return m[1];
}

export function selectMigrationFiles(allFiles, { upTo, skip = [] } = {}) {
  const sorted = allFiles
    .filter((f) => f.endsWith(".sql"))
    .slice()
    .sort();
  const skipSet = new Set(skip);
  let filtered = sorted.filter((f) => !skipSet.has(extractVersion(f)));
  if (upTo) filtered = filtered.filter((f) => extractVersion(f) <= upTo);
  return filtered;
}

// ───────────────────── DB-side logic (importable for integration tests) ─────────────────────

const TRACKING_TABLE_DDL = `
  CREATE TABLE IF NOT EXISTS public.schema_migrations (
    version    TEXT PRIMARY KEY,
    applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
  );
`;

export async function applyAllMigrations({
  sql,
  migrationsDir,
  upTo = null,
  skip = [],
  sets = [],
  logger = console,
}) {
  await sql.unsafe(TRACKING_TABLE_DDL);

  // Set GUCs once on the connection — postgres lib with { max: 1 } reuses one socket,
  // so session-level set_config persists across subsequent unsafe() calls.
  for (const kv of sets) {
    const idx = kv.indexOf("=");
    const k = kv.slice(0, idx);
    const v = kv.slice(idx + 1);
    await sql`SELECT set_config(${k}, ${v}, false)`;
    logger.log(`  GUC set: ${k}=${v}`);
  }

  const appliedRows = await sql`SELECT version FROM public.schema_migrations`;
  const applied = new Set(appliedRows.map((r) => r.version));

  const allFiles = readdirSync(migrationsDir);
  const toApply = selectMigrationFiles(allFiles, { upTo, skip });

  const summary = { applied: [], skipped: [], total: toApply.length };

  for (const file of toApply) {
    const version = extractVersion(file);
    if (applied.has(version)) {
      logger.log(`Skip ${file} (already in schema_migrations)`);
      summary.skipped.push(file);
      continue;
    }
    const path = join(migrationsDir, file);
    const text = readFileSync(path, "utf8");
    logger.log(`Applying ${file} …`);
    try {
      await sql.unsafe(text);
      await sql`INSERT INTO public.schema_migrations(version) VALUES (${version})`;
      logger.log(`  ✓ ${file}`);
      summary.applied.push(file);
    } catch (err) {
      logger.error(`  ✗ ${file} failed: ${err.message}`);
      const wrapped = new Error(`Migration ${file} failed: ${err.message}`);
      wrapped.cause = err;
      throw wrapped;
    }
  }

  return summary;
}

// ───────────────────── CLI entry ─────────────────────

function loadEnvLocal() {
  const envPath = join(dirname(fileURLToPath(import.meta.url)), "../.env.local");
  try {
    const env = readFileSync(envPath, "utf8");
    for (const line of env.split("\n")) {
      const m = line.match(/^([A-Z_][A-Z0-9_]*)=(.+)$/);
      if (m && !process.env[m[1]]) process.env[m[1]] = m[2].trim();
    }
  } catch {
    // .env.local not found — fine in CI
  }
}

function printHelp() {
  console.log(
    [
      "Usage: node scripts/apply-all-migrations.mjs <DATABASE_URL> [options]",
      "",
      "Options:",
      "  --up-to=NNNN              Stop after migration NNNN (inclusive)",
      "  --skip=NNNN               Skip a specific migration version. Repeatable.",
      "                            Example: --skip=0002 (CI vanilla Postgres has no supabase_vault).",
      "  --set key=value           Set a GUC. Repeatable. Example: --set app.designated_org=<uuid>",
      "  --snapshot-mode=MODE      ci-fresh (default) | prod-replay",
      "  --migrations-dir=PATH     Override default supabase/migrations/",
      "  --help                    Show this help",
    ].join("\n"),
  );
}

export async function main(argv = process.argv.slice(2)) {
  let parsed;
  try {
    parsed = parseArgs(argv);
  } catch (err) {
    console.error(`❌ ${err.message}`);
    printHelp();
    process.exit(1);
  }
  if (parsed.help) {
    printHelp();
    process.exit(0);
  }

  loadEnvLocal();
  const url = parsed.databaseUrl || process.env.DATABASE_URL;
  if (!url || !(url.startsWith("postgres://") || url.startsWith("postgresql://"))) {
    console.error("❌ DATABASE_URL not provided as positional arg or env var");
    printHelp();
    process.exit(1);
  }

  const migrationsDir =
    parsed.migrationsDir ||
    join(dirname(fileURLToPath(import.meta.url)), "../supabase/migrations");

  const postgres = require("postgres");
  const sql = postgres(url, { prepare: false, max: 1, onnotice: () => {} });

  try {
    const summary = await applyAllMigrations({
      sql,
      migrationsDir,
      upTo: parsed.upTo,
      skip: parsed.skip,
      sets: parsed.sets,
    });
    console.log(
      `✅ ${summary.applied.length} applied, ${summary.skipped.length} skipped of ${summary.total} candidates`,
    );
  } catch (err) {
    console.error(`❌ ${err.message}`);
    process.exit(2);
  } finally {
    await sql.end({ timeout: 5 });
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main();
}
