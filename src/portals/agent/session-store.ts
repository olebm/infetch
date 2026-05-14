import fs from "node:fs";
import path from "node:path";
import type Database from "better-sqlite3";
import { getDb } from "@/lib/db/client";
import { appConfig } from "@/lib/config/env";

export type BrowserSession = {
  vendorKey: string;
  storageStatePath: string;
  lastLoginAt: string;
  expiresAt: string | null;
};

function sessionDir() {
  const dir = path.join(appConfig.portalStoragePath, "browser-sessions");
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  return dir;
}

export function pathForVendor(vendorKey: string): string {
  return path.join(sessionDir(), `${vendorKey}.storage.json`);
}

export function getBrowserSession(vendorKey: string, db?: Database.Database): BrowserSession | null {
  const row = (db ?? getDb())
    .prepare(
      `SELECT vendor_key AS vendorKey, storage_state_path AS storageStatePath,
        last_login_at AS lastLoginAt, expires_at AS expiresAt
       FROM portal_browser_sessions
       WHERE vendor_key = ?
       LIMIT 1`,
    )
    .get(vendorKey) as BrowserSession | undefined;
  if (!row) return null;
  if (!fs.existsSync(row.storageStatePath)) return null;
  return row;
}

export function saveBrowserSession(input: {
  vendorKey: string;
  storageState: unknown;
  expiresAt?: string | null;
  db?: Database.Database;
}): BrowserSession {
  const db = input.db ?? getDb();
  const filePath = pathForVendor(input.vendorKey);
  fs.writeFileSync(filePath, JSON.stringify(input.storageState), { mode: 0o600 });

  db.prepare(
    `INSERT INTO portal_browser_sessions (vendor_key, storage_state_path, expires_at, last_login_at, updated_at)
     VALUES (?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
     ON CONFLICT(vendor_key) DO UPDATE SET
       storage_state_path = excluded.storage_state_path,
       expires_at = excluded.expires_at,
       last_login_at = CURRENT_TIMESTAMP,
       updated_at = CURRENT_TIMESTAMP`,
  ).run(input.vendorKey, filePath, input.expiresAt ?? null);

  const row = db
    .prepare(
      `SELECT vendor_key AS vendorKey, storage_state_path AS storageStatePath,
        last_login_at AS lastLoginAt, expires_at AS expiresAt
       FROM portal_browser_sessions
       WHERE vendor_key = ?`,
    )
    .get(input.vendorKey) as BrowserSession;
  return row;
}

export function invalidateBrowserSession(vendorKey: string, db?: Database.Database) {
  const resolved = db ?? getDb();
  const existing = getBrowserSession(vendorKey, resolved);
  if (existing && fs.existsSync(existing.storageStatePath)) {
    try {
      fs.unlinkSync(existing.storageStatePath);
    } catch {
      // ignore
    }
  }
  resolved.prepare(`DELETE FROM portal_browser_sessions WHERE vendor_key = ?`).run(vendorKey);
}
