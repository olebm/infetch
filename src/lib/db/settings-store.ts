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
