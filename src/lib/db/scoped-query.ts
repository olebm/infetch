import type postgres from "postgres";
import { sql } from "@/lib/db/client";

/**
 * An sql client narrowed to a single organization. Identical to the raw
 * postgres tagged-template at runtime, but distinguished by type/identity
 * so that:
 *
 *   1. ESLint forbids importing the bare `sql` from `@/lib/db/client`
 *      everywhere except this file + `unsafe-global.ts`. Callers are
 *      forced to go through `getCurrentAuth().scopedSql` (or
 *      `createScopedSql(orgId)`), which proves the org has been resolved.
 *   2. `grep -rn "unsafeGlobalSql"` becomes the audit command for
 *      cross-org access — anything that does NOT use `scopedSql` is a
 *      deliberate, named opt-out.
 *
 * Future Defense-in-Depth: this is the layer where we will execute every
 * query inside `sql.begin` + `SET LOCAL app.current_org = orgId` so RLS
 * policies become a second defense without changing any call site. Until
 * then, `createScopedSql` is identity at runtime; the value is purely the
 * import discipline.
 */
export type ScopedSql = postgres.Sql;

export function createScopedSql(orgId: string): ScopedSql {
  // orgId is consumed via the closure once the SET LOCAL path is wired up
  // (planned follow-up). For now it's the marker that callers had to
  // resolve an org before they could obtain a ScopedSql instance.
  void orgId;
  return sql;
}
