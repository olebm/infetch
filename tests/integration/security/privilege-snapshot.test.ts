import { describe, expect, it } from "vitest";
// Catalog introspection is cross-org by nature (system-level), so the
// non-scoped client is the honest choice here.
import { unsafeGlobalSql as sql } from "@/lib/db/unsafe-global";
import allowlist from "./privilege-allowlist.json";

// Privilege snapshot (Stufe-2 gate, see docs/adr/0000-stufe-und-gates.md).
//
// The multi-tenant leak class is "a privilege drifts and nobody notices":
// RLS gets switched off, a SECURITY DEFINER function appears, a new org-scoped
// table ships without RLS. This test pins the privilege surface of the `public`
// schema against privilege-allowlist.json and goes red on any drift.
//
// Why public-schema-only (no role attributes): Postgres roles are provisioned
// by the platform (Supabase) and differ across CI vanilla-pg / local / prod, so
// snapshotting them would be all false positives. The migration-defined surface
// (RLS flags, policies, public functions) is identical across those envs.
//
// Runs in the CI `test` job (Postgres 16 with all migrations applied). Skips
// without a DB so it never blocks an env that has no database.

const hasDb = Boolean(process.env.DATABASE_URL);

async function column(query: Promise<{ name: string }[]>): Promise<string[]> {
  const rows = await query;
  return rows.map((r) => r.name);
}

describe.skipIf(!hasDb)("privilege snapshot — public schema", () => {
  it("RLS-enabled tables match the committed allowlist (red on any toggle)", async () => {
    const live = await column(sql<{ name: string }[]>`
      SELECT c.relname AS name
      FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'public' AND c.relkind = 'r' AND c.relrowsecurity
      ORDER BY 1
    `);
    expect(live).toEqual([...allowlist.rlsEnabledTables].sort());
  });

  it("no SECURITY DEFINER functions in public beyond the allowlist", async () => {
    const live = await column(sql<{ name: string }[]>`
      SELECT p.proname AS name
      FROM pg_proc p
      JOIN pg_namespace n ON n.oid = p.pronamespace
      WHERE n.nspname = 'public' AND p.prosecdef
      ORDER BY 1
    `);
    expect(live).toEqual([...allowlist.securityDefinerFunctions].sort());
  });

  it("every org-scoped table (carries organization_id) has RLS enabled", async () => {
    // Independent of the allowlist: a NEW org-scoped table that forgets RLS
    // would not appear in the snapshot above (so that test would still pass) —
    // this one catches it directly. This is the leak-critical invariant.
    const unprotected = await column(sql<{ name: string }[]>`
      SELECT c.relname AS name
      FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'public' AND c.relkind = 'r' AND NOT c.relrowsecurity
        AND EXISTS (
          SELECT 1 FROM information_schema.columns col
          WHERE col.table_schema = 'public'
            AND col.table_name = c.relname
            AND col.column_name = 'organization_id'
        )
      ORDER BY 1
    `);
    expect(unprotected).toEqual([]);
  });

  it("RLS-enabled tables with no policy are only the known deny-all set", async () => {
    // RLS on + zero policies = default-deny for every non-superuser. That is
    // intentional for system tables but a footgun if a real table forgets its
    // policy, so the set is pinned.
    const denyAll = await column(sql<{ name: string }[]>`
      SELECT c.relname AS name
      FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'public' AND c.relkind = 'r' AND c.relrowsecurity
        AND NOT EXISTS (
          SELECT 1 FROM pg_policies p
          WHERE p.schemaname = 'public' AND p.tablename = c.relname
        )
      ORDER BY 1
    `);
    expect(denyAll).toEqual([...allowlist.rlsEnabledTablesWithoutPolicy].sort());
  });
});
