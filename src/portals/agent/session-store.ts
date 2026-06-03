import { unsafeGlobalSql as sql } from "@/lib/db/unsafe-global";
import {
  BUCKETS,
  uploadToStorage,
  downloadFromStorage,
  deleteFromStorage,
} from "@/lib/supabase/storage";

export type BrowserSession = {
  vendorKey: string;
  storageState: unknown; // parsed JSON, ready for Playwright
  storageStateKey: string; // Storage bucket key (for DB)
  lastLoginAt: string;
  expiresAt: string | null;
};

type SessionDbRow = {
  vendorKey: string;
  storageStatePath: string; // DB column — now holds Storage key
  lastLoginAt: string;
  expiresAt: string | null;
};

function storageKeyForVendor(vendorKey: string): string {
  return `${vendorKey}.storage.json`;
}

export async function getBrowserSession(vendorKey: string): Promise<BrowserSession | null> {
  const rows = await sql<SessionDbRow[]>`
    SELECT vendor_key AS "vendorKey", storage_state_path AS "storageStatePath",
      last_login_at AS "lastLoginAt", expires_at AS "expiresAt"
    FROM portal_browser_sessions
    WHERE vendor_key = ${vendorKey}
    LIMIT 1
  `;
  const row = rows[0];
  if (!row) return null;

  try {
    const buf = await downloadFromStorage(BUCKETS.PORTAL_SESSIONS, row.storageStatePath);
    const storageState = JSON.parse(buf.toString("utf8"));
    return {
      vendorKey: row.vendorKey,
      storageState,
      storageStateKey: row.storageStatePath,
      lastLoginAt: row.lastLoginAt,
      expiresAt: row.expiresAt,
    };
  } catch {
    // Storage file not found or unreadable — treat as no session
    return null;
  }
}

export async function saveBrowserSession(input: {
  vendorKey: string;
  storageState: unknown;
  expiresAt?: string | null;
}): Promise<BrowserSession> {
  const storageKey = storageKeyForVendor(input.vendorKey);
  const json = JSON.stringify(input.storageState);
  await uploadToStorage(BUCKETS.PORTAL_SESSIONS, storageKey, json, {
    contentType: "application/json",
  });

  await sql`
    INSERT INTO portal_browser_sessions (vendor_key, storage_state_path, expires_at, last_login_at, updated_at)
    VALUES (${input.vendorKey}, ${storageKey}, ${input.expiresAt ?? null}, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
    ON CONFLICT(vendor_key) DO UPDATE SET
      storage_state_path = excluded.storage_state_path,
      expires_at = excluded.expires_at,
      last_login_at = CURRENT_TIMESTAMP,
      updated_at = CURRENT_TIMESTAMP
  `;

  const rows = await sql<SessionDbRow[]>`
    SELECT vendor_key AS "vendorKey", storage_state_path AS "storageStatePath",
      last_login_at AS "lastLoginAt", expires_at AS "expiresAt"
    FROM portal_browser_sessions
    WHERE vendor_key = ${input.vendorKey}
  `;
  const row = rows[0];
  return {
    vendorKey: row.vendorKey,
    storageState: input.storageState,
    storageStateKey: row.storageStatePath,
    lastLoginAt: row.lastLoginAt,
    expiresAt: row.expiresAt,
  };
}

export async function invalidateBrowserSession(vendorKey: string): Promise<void> {
  const storageKey = storageKeyForVendor(vendorKey);
  await deleteFromStorage(BUCKETS.PORTAL_SESSIONS, storageKey);
  await sql`DELETE FROM portal_browser_sessions WHERE vendor_key = ${vendorKey}`;
}
