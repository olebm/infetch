import { sql } from "@/lib/db/client";

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
