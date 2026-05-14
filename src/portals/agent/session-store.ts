import fs from "node:fs";
import path from "node:path";
import { sql } from "@/lib/db/client";
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

export async function getBrowserSession(vendorKey: string): Promise<BrowserSession | null> {
  const rows = await sql<BrowserSession[]>`
    SELECT vendor_key AS "vendorKey", storage_state_path AS "storageStatePath",
      last_login_at AS "lastLoginAt", expires_at AS "expiresAt"
    FROM portal_browser_sessions
    WHERE vendor_key = ${vendorKey}
    LIMIT 1
  `;
  const row = rows[0];
  if (!row) return null;
  if (!fs.existsSync(row.storageStatePath)) return null;
  return row;
}

export async function saveBrowserSession(input: {
  vendorKey: string;
  storageState: unknown;
  expiresAt?: string | null;
}): Promise<BrowserSession> {
  const filePath = pathForVendor(input.vendorKey);
  fs.writeFileSync(filePath, JSON.stringify(input.storageState), { mode: 0o600 });

  await sql`
    INSERT INTO portal_browser_sessions (vendor_key, storage_state_path, expires_at, last_login_at, updated_at)
    VALUES (${input.vendorKey}, ${filePath}, ${input.expiresAt ?? null}, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
    ON CONFLICT(vendor_key) DO UPDATE SET
      storage_state_path = excluded.storage_state_path,
      expires_at = excluded.expires_at,
      last_login_at = CURRENT_TIMESTAMP,
      updated_at = CURRENT_TIMESTAMP
  `;

  const rows = await sql<BrowserSession[]>`
    SELECT vendor_key AS "vendorKey", storage_state_path AS "storageStatePath",
      last_login_at AS "lastLoginAt", expires_at AS "expiresAt"
    FROM portal_browser_sessions
    WHERE vendor_key = ${input.vendorKey}
  `;
  return rows[0];
}

export async function invalidateBrowserSession(vendorKey: string): Promise<void> {
  const existing = await getBrowserSession(vendorKey);
  if (existing && fs.existsSync(existing.storageStatePath)) {
    try {
      fs.unlinkSync(existing.storageStatePath);
    } catch {
      // ignore
    }
  }
  await sql`DELETE FROM portal_browser_sessions WHERE vendor_key = ${vendorKey}`;
}
