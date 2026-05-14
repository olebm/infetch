/**
 * Portal-Credential-Meta: Username pro Vendor.
 * Quelle ist die vendors-Tabelle (vendor.canonical_key) plus eine settings-JSON-Map fuer
 * den Benutzernamen. Passwoerter liegen im OS-Keychain (scope='portal', ownerId=vendorKey).
 *
 * Es gibt keine kuratierte Liste mehr — Vendors entstehen organisch aus Mails oder werden
 * vom User manuell hinzugefuegt.
 */

import type Database from "better-sqlite3";
import { readJsonSetting, writeJsonSetting } from "@/lib/db/settings-store";
import { readCredentialSecret } from "@/lib/secrets/credential-store";
import { getDb } from "@/lib/db/client";

export type PortalCredentialMeta = {
  vendorKey: string;
  username: string;
  updatedAt: string;
};

const settingKey = "portal_credentials_meta";

export function getPortalCredentialMetaMap() {
  return readJsonSetting<Record<string, PortalCredentialMeta>>(settingKey, {});
}

export function getPortalCredentialMetaList(): Array<{
  vendorKey: string;
  username: string;
  updatedAt: string | null;
}> {
  const meta = getPortalCredentialMetaMap();
  return Object.values(meta).map((entry) => ({
    vendorKey: entry.vendorKey,
    username: entry.username,
    updatedAt: entry.updatedAt ?? null,
  }));
}

export function savePortalCredentialMeta(input: { vendorKey: string; username: string }) {
  const meta = getPortalCredentialMetaMap();
  meta[input.vendorKey] = {
    vendorKey: input.vendorKey,
    username: input.username,
    updatedAt: new Date().toISOString(),
  };
  writeJsonSetting(settingKey, meta);
}

export function resetPortalCredentialMeta(vendorKey: string) {
  const meta = getPortalCredentialMetaMap();
  if (!meta[vendorKey]) return;
  delete meta[vendorKey];
  writeJsonSetting(settingKey, meta);
}

export async function readPortalCredential(vendorKey: string, db?: Database.Database) {
  const meta = getPortalCredentialMetaMap()[vendorKey];
  if (!meta?.username) return null;

  const password = await readCredentialSecret({
    scope: "portal",
    ownerId: vendorKey,
    db,
  });
  if (!password) return null;

  return {
    username: meta.username,
    password,
  };
}

/**
 * Listet alle Vendors auf, die ein konfiguriertes Online-Konto haben:
 * - Eintrag in der credential-meta-Map (Username vorhanden)
 * - Login-URL in der vendors-Tabelle gesetzt
 */
export type OnlineAccount = {
  vendorId: number;
  vendorKey: string;
  vendorName: string;
  username: string;
  loginUrl: string | null;
  category: string | null;
  updatedAt: string | null;
};

export function listOnlineAccounts(db?: Database.Database): OnlineAccount[] {
  const resolved = db ?? getDb();
  const meta = getPortalCredentialMetaMap();
  const vendorKeys = Object.keys(meta);
  if (vendorKeys.length === 0) return [];
  const placeholders = vendorKeys.map(() => "?").join(",");
  const rows = resolved
    .prepare(
      `SELECT id AS vendorId, name AS vendorName, canonical_key AS vendorKey,
        portal_login_url AS loginUrl, portal_category AS category
       FROM vendors WHERE canonical_key IN (${placeholders})
       ORDER BY name COLLATE NOCASE`,
    )
    .all(...vendorKeys) as Array<{
      vendorId: number;
      vendorName: string;
      vendorKey: string;
      loginUrl: string | null;
      category: string | null;
    }>;

  return rows.map((row) => ({
    vendorId: row.vendorId,
    vendorKey: row.vendorKey,
    vendorName: row.vendorName,
    username: meta[row.vendorKey]?.username ?? "",
    loginUrl: row.loginUrl,
    category: row.category,
    updatedAt: meta[row.vendorKey]?.updatedAt ?? null,
  }));
}
