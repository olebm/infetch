import type postgres from "postgres";
import { unsafeGlobalSql as sql } from "@/lib/db/unsafe-global";

/**
 * Cross-Prozess-Mutex via Postgres Advisory Lock.
 *
 * Der In-Memory-`running`-Flag im Auto-Pilot schützt nur einen einzelnen
 * Node-Prozess. Bei mehreren Replicas oder parallelem manuellem Trigger
 * (UI-Action, API-Route) liefen Scan/Export sonst doppelt:
 * Doppelverarbeitung, doppelte Buchhaltungs-Mails, doppelte KI-Kosten.
 *
 * `pg_try_advisory_lock` ist nicht-blockierend: ist der Lock belegt, wird
 * `onBusy()` ausgeführt (typisch: sauberes Skip). Lock + Unlock laufen
 * über eine dedizierte, reservierte Verbindung (session-scoped Lock
 * erfordert dieselbe Connection).
 */
export async function withAdvisoryLock<T>(
  key: string,
  fn: () => Promise<T>,
  onBusy: () => T | Promise<T>,
): Promise<T> {
  // In Tests deaktiviert: parallele Vitest-Worker teilen sich dieselbe DB;
  // ein globaler Lock würde Tests gegenseitig aushungern lassen.
  if (process.env.VITEST) {
    return fn();
  }

  const reserved = await sql.reserve();
  try {
    const rows = await reserved<{ locked: boolean }[]>`
      SELECT pg_try_advisory_lock(hashtext(${key})) AS locked
    `;
    if (!rows[0]?.locked) {
      return await onBusy();
    }
    try {
      return await fn();
    } finally {
      await reserved`SELECT pg_advisory_unlock(hashtext(${key}))`;
    }
  } finally {
    reserved.release();
  }
}

/**
 * Block-wait advisory lock scoped to a single organization. Use for
 * operations that MUST be serialized across all replicas + manual
 * triggers WITHIN one organization, but can run concurrently FOR
 * DIFFERENT organizations (Phase-2 multi-tenant hardening, plan W11).
 *
 * Why blocking vs. `withAdvisoryLock`:
 *   - `withAdvisoryLock(key, fn, onBusy)` is non-blocking: if busy, skip.
 *     Right for "single runner across replicas; second trigger drops."
 *   - `withOrgLock(orgId, fn)` is blocking + transactional: the second
 *     caller waits, then runs. Right for "every call MUST execute, but
 *     not concurrently per org" — e.g. per-org quota update (TOCTOU),
 *     per-org credential rotation, per-org export sequence.
 *
 * Lock is XACT-scoped (`pg_advisory_xact_lock`): released automatically
 * on commit or abort. The `fn` callback receives the locked transaction
 * client — all queries inside must go through it, otherwise the lock
 * scope is moot.
 *
 * Different orgs use different lock keys (hash of "org:<id>") and never
 * block each other.
 */
export async function withOrgLock<T>(
  organizationId: string,
  fn: (tx: postgres.Sql) => Promise<T>,
): Promise<T> {
  // In Tests: parallel Vitest workers share one DB. A real org-lock would
  // serialize unrelated tests on the same org id and could deadlock under
  // serial-fileParallelism. Pass through with the global client; tests that
  // need to exercise the lock semantics use a separate integration test
  // that opts in via DISABLE_LOCK_BYPASS=1.
  if (process.env.VITEST && process.env.DISABLE_LOCK_BYPASS !== "1") {
    return fn(sql);
  }

  const key = `org:${organizationId}`;
  return sql.begin(async (tx) => {
    await tx`SELECT pg_advisory_xact_lock(hashtext(${key}))`;
    return await fn(tx as unknown as postgres.Sql);
  }) as Promise<T>;
}
