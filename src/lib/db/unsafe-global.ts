import { sql } from "@/lib/db/client";

/**
 * Explicit alias for the global (un-org-scoped) sql client.
 *
 * Use this name ONLY for queries that intentionally cross orgs:
 *   - admin / system tasks (schema introspection, cron orchestration,
 *     cross-tenant migrations, audit reports)
 *   - bootstrap paths before an org is resolved (auth setup, account
 *     creation, Stripe webhook entry points)
 *   - test fixtures that seed/cleanup multiple orgs at once
 *
 * The bare `sql` import from `@/lib/db/client` is restricted via ESLint
 * (`no-restricted-imports` in `eslint.config.mjs`). Every legitimate
 * cross-org access must use `unsafeGlobalSql` — `grep -rn "unsafeGlobalSql"
 * src/` is the canonical audit command.
 *
 * For org-scoped queries, use `createScopedSql(orgId)` from
 * `@/lib/db/scoped-query` (or get it from `getCurrentAuth().scopedSql`).
 */
export const unsafeGlobalSql = sql;
