import type Database from "better-sqlite3";
import { getDb } from "@/lib/db/client";

export function readJsonSetting<T>(key: string, fallback: T, db: Database.Database = getDb()) {
  const row = db.prepare(`SELECT value_json AS valueJson FROM settings WHERE key = ?`).get(key) as
    | { valueJson: string }
    | undefined;

  if (!row?.valueJson) return fallback;

  try {
    return JSON.parse(row.valueJson) as T;
  } catch {
    return fallback;
  }
}

export function writeJsonSetting(key: string, value: unknown, db: Database.Database = getDb()) {
  db.prepare(
    `INSERT INTO settings (key, value_json, updated_at)
     VALUES (?, ?, CURRENT_TIMESTAMP)
     ON CONFLICT(key) DO UPDATE SET
       value_json = excluded.value_json,
       updated_at = CURRENT_TIMESTAMP`,
  ).run(key, JSON.stringify(value));
}
