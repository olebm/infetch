import type postgres from "postgres";
import { sql } from "@/lib/db/client";

/**
 * An sql client narrowed to a single organization.
 *
 * Runtime behavior (INFETCH-175):
 *   Each `scoped\`…\`` invocation opens a postgres transaction, sets
 *   `app.current_org` via `set_config()` (parameter-safe, no string-concat),
 *   then executes the caller's query within that transaction. RLS policies
 *   added in migration 0026 read `current_setting('app.current_org')` as a
 *   second defense layer alongside the manual `WHERE organization_id = …`
 *   filters — so a forgotten manual filter still cannot leak across orgs.
 *
 * Trade-offs:
 *   - Each scoped query is its own transaction → +1 round-trip to set
 *     `app.current_org`. For Server-Action workloads (1–5 queries/request)
 *     this is acceptable; for tight inner loops, use {@link withScopedSql}.
 *   - Queries inside one scoped`…` call are NOT atomic with each other.
 *     Use `withScopedSql(orgId, async (tx) => { ... })` for read-then-write
 *     sequences that must commit together.
 *
 * Why a Proxy on a dummy function:
 *   We need the wrapper to be callable as a tagged template
 *   (`scoped\`SELECT …\``). A normal `function scoped(strings, ...values)`
 *   would work too, but the Proxy-on-dummy lets TypeScript treat the
 *   return value as `postgres.Sql` (same shape as the bare `sql`) without
 *   re-implementing every adapter method (`unsafe`, `begin`, etc.) — only
 *   the tagged-template call path is rewritten.
 *
 * ESLint discipline (eslint.config.mjs):
 *   The bare `sql` import from `@/lib/db/client` is forbidden everywhere
 *   except this file and `unsafe-global.ts`. Callers must go through
 *   `getCurrentAuth().scopedSql` / `createScopedSql(orgId)` (org-scoped)
 *   or `unsafeGlobalSql` (explicit cross-org, audit-able via grep).
 */
export type ScopedSql = postgres.Sql;

const ORG_ID_PATTERN = /^[a-zA-Z0-9_-]{1,128}$/;

export function createScopedSql(orgId: string): ScopedSql {
  if (!orgId || typeof orgId !== "string") {
    throw new Error("createScopedSql requires a non-empty orgId string.");
  }
  // Belt-and-suspenders: even though set_config() takes orgId as a parameter
  // (so SQL-injection-safe by construction), reject IDs that don't match the
  // expected shape. organizationId values in the schema are TEXT but in
  // practice are UUIDs or short slugs. This catches accidental misuse early.
  if (!ORG_ID_PATTERN.test(orgId)) {
    throw new Error(`createScopedSql: orgId "${orgId.slice(0, 32)}..." has unexpected shape.`);
  }

  // Proxy on a dummy function: the apply-trap intercepts tagged-template
  // invocations of the scoped wrapper. We can't proxy `sql` directly here
  // because `sql` is also a function with methods (`unsafe`, `begin`, etc.)
  // and forwarding ALL of those to a wrapped transaction would re-introduce
  // the same audit problem we're trying to solve.
  const scoped = new Proxy(function () {} as unknown as ScopedSql, {
    apply(_target, _thisArg, args) {
      return sql.begin(async (tx) => {
        // Parameter-safe set_config: orgId is bound as $1 by postgres.js;
        // the SQL string itself never embeds it.
        await tx`SELECT set_config('app.current_org', ${orgId}, true)`;
        // Forward the original tagged-template arguments to tx. tx is the
        // transaction-bound sql instance and supports the same tagged-
        // template protocol as the top-level sql. We verified this codepath
        // executes the query as a parameterized statement (no SQL injection
        // via values), not as raw text.
        return (tx as unknown as (...a: unknown[]) => unknown)(...args);
      }) as unknown as postgres.PendingQuery<postgres.Row[]>;
    },
  });

  return scoped;
}

/**
 * Multi-query atomic scope. Use when several queries must run inside the
 * same transaction (e.g. read-then-write that must not race with another
 * writer). `app.current_org` is set once via `set_config`; the callback
 * receives the transaction-bound `tx` to use for all queries within.
 *
 * @example
 * await withScopedSql(orgId, async (tx) => {
 *   const [current] = await tx`SELECT … FROM invoices WHERE id = ${id}`;
 *   await tx`UPDATE invoices SET … WHERE id = ${id}`;
 * });
 */
export async function withScopedSql<T>(
  orgId: string,
  cb: (tx: postgres.TransactionSql) => Promise<T>,
): Promise<T> {
  if (!orgId || typeof orgId !== "string" || !ORG_ID_PATTERN.test(orgId)) {
    throw new Error("withScopedSql requires a valid orgId.");
  }
  return sql.begin(async (tx) => {
    await tx`SELECT set_config('app.current_org', ${orgId}, true)`;
    return cb(tx);
  }) as Promise<T>;
}
