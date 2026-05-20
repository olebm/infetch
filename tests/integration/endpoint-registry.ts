// Cross-org by design: fuzz seeds rows for both orgA and orgB to prove
// isolation. unsafeGlobalSql is the canonical opt-out for this case.
import { unsafeGlobalSql as sql } from "@/lib/db/unsafe-global";

/**
 * Registry of tables that carry `organization_id` and the minimal seed
 * recipe to insert a row attributed to a specific org. The cross-tenant
 * fuzz harness (`tenant-fuzz.test.ts`) iterates this registry to prove
 * that org-scoped queries never bleed rows from another org.
 *
 * Why a registry instead of fully dynamic seeding:
 *   Dynamic seeding from `information_schema.columns` is tempting but
 *   stalls on NOT NULL columns, FK constraints, and CHECK rules that
 *   differ per table. Explicit seed functions make the surface visible
 *   and force new tables to be added here at PR time — this is the
 *   "manual mapping" that scope W2 calls for.
 *
 * How to add a table:
 *   1. Add an entry below with the table name and a `seed(orgId, suffix)`
 *      function that inserts ONE row attributed to that org.
 *   2. The `suffix` is a per-run identifier (timestamp) so parallel
 *      seeds in the test don't collide on unique columns.
 *   3. The `cleanup(suffix)` step in tenant-fuzz.test.ts deletes by the
 *      same marker — make seeds idempotent in their UNIQUE columns.
 *
 * If a table is intentionally global / system-level (e.g. `vendors`
 * before 0019, `sync_runs`), do NOT add it here — add it to
 * `CROSS_ORG_INTENTIONAL` instead so the audit is explicit.
 */

export type SeedFn = (orgId: string, suffix: string) => Promise<void>;

export interface OrgScopedEndpoint {
  /** Postgres table this entry covers. */
  table: string;
  /** Inserts one row attributed to `orgId`. */
  seed: SeedFn;
  /** Optional human-readable note about why this table is org-scoped. */
  note?: string;
}

export const ORG_SCOPED_TABLES: OrgScopedEndpoint[] = [
  {
    table: "invoices",
    note: "Per-org invoice records — the central org-scoped table.",
    async seed(orgId, suffix) {
      await sql`
        INSERT INTO invoices (vendor_id, source, status, invoice_number, organization_id)
        VALUES (NULL, 'manual', 'new', ${`fuzz-${orgId}-${suffix}`}, ${orgId})
      `;
    },
  },
  {
    table: "vendors",
    note: "Org-scoped vendors (vendor_aliases is denormalized through this).",
    async seed(orgId, suffix) {
      await sql`
        INSERT INTO vendors (name, canonical_key, category, organization_id)
        VALUES (${`Fuzz ${orgId}`}, ${`fuzz-${orgId}-${suffix}`}, 'unknown', ${orgId})
      `;
    },
  },
  {
    table: "export_targets",
    note: "Per-org export targets (organization_id added in 0013).",
    async seed(orgId, suffix) {
      // Schema (0001 + 0013): target IN ('kontist','accountable'), label NOT NULL,
      // UNIQUE(organization_id, target). Use 'kontist' — different orgs can share
      // the same target string because the unique index is per-org.
      await sql`
        INSERT INTO export_targets (target, label, organization_id)
        VALUES ('kontist', ${`Fuzz target ${suffix}`}, ${orgId})
      `;
    },
  },
  {
    table: "credential_refs",
    note: "Org-scoped credential metadata (the secret itself lives in vault).",
    async seed(orgId, suffix) {
      await sql`
        INSERT INTO credential_refs (scope, owner_id, label, secret_store, secret_ref, status, organization_id)
        VALUES ('imap', 'default', ${`fuzz ${orgId}`}, 'os_keychain', ${`invoice-agent:fuzz:${suffix}:${orgId}`}, 'configured', ${orgId})
      `;
    },
  },
];

/**
 * Tables that exist but are deliberately NOT org-scoped today. Listed here
 * so an automated check (the schema-guard test) can fail loudly when a new
 * table appears that is neither in `ORG_SCOPED_TABLES` nor here.
 */
export const CROSS_ORG_INTENTIONAL: readonly string[] = [
  "organizations", // the org table itself
  "users", // shared user accounts
  "org_members", // bridge — has org_id but tested separately
  "sync_runs", // system-wide; org_id migration is a future drift fix
  "schema_migrations", // bookkeeping
];

/**
 * Org-scoped tables whose seed function is not in the registry yet. The
 * schema-guard test counts them as "known" so the harness can land, but
 * they have a follow-up issue to expand the registry. Move each entry
 * into `ORG_SCOPED_TABLES` (with a real `seed(orgId, suffix)`) once its
 * FK dependencies and NOT NULL columns are wired up.
 *
 * All entries have an `organization_id` column today (0019/0020 added
 * most of them). Their seeds need rows in `invoices` / `vendors` etc.
 * which the simple inline registry pattern doesn't handle yet.
 */
export const ORG_SCOPED_DEFERRED: readonly string[] = [
  "auto_approval_rules", // 0019
  "discovered_senders", // 0020
  "exports", // depends on invoices + export_targets
  "integration_targets", // 0019
  "invoice_files", // 0019, depends on invoices
  "mail_accounts", // 0001
  "mail_inbound_addresses", // 0001
  "portal_recipes", // 0025+ — Portal-Spuren multi-tenant
  "portal_run_logs", // 0025+ — Portal-Spuren multi-tenant
  "usage_events", // 0001
  "vendor_month_status", // 0019, depends on vendors
];
