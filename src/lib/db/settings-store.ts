import { unsafeGlobalSql as sql } from "@/lib/db/unsafe-global";

export async function readJsonSetting<T>(key: string, fallback: T): Promise<T> {
  const rows = await sql<{ valueJson: string }[]>`
    SELECT value_json AS "valueJson" FROM settings WHERE key = ${key} LIMIT 1
  `;
  const row = rows[0];

  if (!row?.valueJson) return fallback;

  try {
    return JSON.parse(row.valueJson) as T;
  } catch {
    return fallback;
  }
}

export async function writeJsonSetting(key: string, value: unknown): Promise<void> {
  await sql`
    INSERT INTO settings (key, value_json, updated_at)
    VALUES (${key}, ${JSON.stringify(value)}, CURRENT_TIMESTAMP)
    ON CONFLICT(key) DO UPDATE SET
      value_json = excluded.value_json,
      updated_at = CURRENT_TIMESTAMP
  `;
}

// `settings` ist eine globale key→value-Tabelle ohne organization_id-Spalte.
// Mandanten-Trennung für user-editierbare Settings läuft daher über einen
// Key-Suffix `${key}:${orgId}`.
const MISSING_SETTING = Symbol("missing-setting");

/**
 * Per-Org-Lesen: liest `${key}:${orgId}`. Fehlt der Wert, fällt es auf den
 * Legacy-Globalkey `key` zurück — migrations-sicher: vor Einführung der
 * Org-Trennung gespeicherte Werte (z.B. ole's bestehende Betreffvorlage)
 * bleiben sichtbar, bis der Mandant das Setting neu speichert (dann landet es
 * org-gescopt). Ohne `orgId` wird direkt der Globalkey gelesen.
 */
export async function readOrgJsonSetting<T>(
  key: string,
  orgId: string | null | undefined,
  fallback: T,
): Promise<T> {
  if (!orgId) return readJsonSetting(key, fallback);
  const scoped = await readJsonSetting<T | typeof MISSING_SETTING>(
    `${key}:${orgId}`,
    MISSING_SETTING,
  );
  return scoped === MISSING_SETTING ? readJsonSetting(key, fallback) : scoped;
}

/**
 * Per-Org-Schreiben: schreibt ausschließlich `${key}:${orgId}` — nie den
 * Globalkey, damit Mandanten sich nicht gegenseitig überschreiben. Ohne `orgId`
 * (Defensive; sollte nicht vorkommen) fällt es auf den Globalkey zurück.
 */
export async function writeOrgJsonSetting(
  key: string,
  orgId: string | null | undefined,
  value: unknown,
): Promise<void> {
  await writeJsonSetting(orgId ? `${key}:${orgId}` : key, value);
}

/**
 * Per-User-Lesen: liest `${key}:user:${userId}`, sonst Fallback auf den alten
 * globalen Key (Legacy-Migrationspfad), sonst `fallback`. Für persönliche
 * Präferenzen (Sprache, Zeitzone) — ein Nutzer ändert sie nur für sich, nicht
 * für andere. `:user:`-Suffix kollidiert nicht mit dem Org-Suffix (`:${orgId}`).
 */
export async function readUserJsonSetting<T>(
  key: string,
  userId: string | null | undefined,
  fallback: T,
): Promise<T> {
  if (!userId) return readJsonSetting(key, fallback);
  const scoped = await readJsonSetting<T | typeof MISSING_SETTING>(
    `${key}:user:${userId}`,
    MISSING_SETTING,
  );
  return scoped === MISSING_SETTING ? readJsonSetting(key, fallback) : scoped;
}

/**
 * Per-User-Schreiben: schreibt ausschließlich `${key}:user:${userId}` — nie den
 * Globalkey, damit Nutzer sich nicht gegenseitig überschreiben.
 */
export async function writeUserJsonSetting(
  key: string,
  userId: string | null | undefined,
  value: unknown,
): Promise<void> {
  await writeJsonSetting(userId ? `${key}:user:${userId}` : key, value);
}
