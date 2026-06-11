/**
 * Portal-Credential-Meta: Username pro Vendor — ORG-SCOPED (INFETCH-261).
 *
 * Speicherung in der settings-JSON-Map unter `portal_credentials_meta:${orgId}`
 * (via readOrgJsonSetting/writeOrgJsonSetting). Vor 261 lag die Map global, wodurch
 * Org B die Online-Konten (Usernames, Vendoren) von Org A sah — ein Cross-Tenant-Leak
 * auf Meta-Ebene. Passwörter liegen org-eindeutig im Credential-Store
 * (scope='portal', ownerId=vendorKey; vendorKeys sind seit INFETCH-236 global eindeutig).
 *
 * Es gibt keine kuratierte Liste mehr — Vendors entstehen organisch aus Mails oder
 * werden vom User manuell hinzugefuegt.
 */

import { unsafeGlobalSql as sql } from "@/lib/db/unsafe-global";
import { readOrgJsonSetting, writeOrgJsonSetting } from "@/lib/db/settings-store";
import { readCredentialSecret } from "@/lib/secrets/credential-store";

export type PortalCredentialMeta = {
  vendorKey: string;
  username: string;
  updatedAt: string;
};

const settingKey = "portal_credentials_meta";

export async function getPortalCredentialMetaMap(
  organizationId: string | null | undefined,
): Promise<Record<string, PortalCredentialMeta>> {
  return readOrgJsonSetting<Record<string, PortalCredentialMeta>>(settingKey, organizationId, {});
}

export async function savePortalCredentialMeta(input: {
  vendorKey: string;
  username: string;
  organizationId: string | null | undefined;
}): Promise<void> {
  const meta = await getPortalCredentialMetaMap(input.organizationId);
  meta[input.vendorKey] = {
    vendorKey: input.vendorKey,
    username: input.username,
    updatedAt: new Date().toISOString(),
  };
  await writeOrgJsonSetting(settingKey, input.organizationId, meta);
}

export async function resetPortalCredentialMeta(
  vendorKey: string,
  organizationId: string | null | undefined,
): Promise<void> {
  const meta = await getPortalCredentialMetaMap(organizationId);
  if (!meta[vendorKey]) return;
  delete meta[vendorKey];
  await writeOrgJsonSetting(settingKey, organizationId, meta);
}

export async function readPortalCredential(
  vendorKey: string,
  organizationId: string | null | undefined,
) {
  const meta = (await getPortalCredentialMetaMap(organizationId))[vendorKey];
  if (!meta?.username) return null;

  const password = await readCredentialSecret({
    scope: "portal",
    ownerId: vendorKey,
    organizationId,
  });
  if (!password) return null;

  return {
    username: meta.username,
    password,
  };
}

/**
 * Ermittelt die besitzende Organisation eines Portal-Kontos über credential_refs
 * (org-scoped, autoritativ). Bridge von vendorKey → Org für Agent + Cron-Gating.
 */
export async function getPortalAccountOrg(vendorKey: string): Promise<string | null> {
  // owner_id ist der Klartext-vendorKey; der secret_ref ist gehasht (enthält den
  // Key NICHT) — daher Lookup über owner_id, nicht secret_ref LIKE (INFETCH-262).
  const rows = await sql<{ organization_id: string | null }[]>`
    SELECT organization_id FROM credential_refs
    WHERE scope = 'portal' AND owner_id = ${vendorKey}
      AND organization_id IS NOT NULL
    ORDER BY created_at ASC
    LIMIT 1
  `;
  return rows[0]?.organization_id ?? null;
}

/**
 * Enumeriert die Portal-Konten ALLER Orgs für den Cron — aus credential_refs
 * (org-autoritativ), nicht aus der jetzt org-scoped Meta-Map (die kein
 * org-übergreifendes Lesen mehr erlaubt). created_at dient als stabile
 * Reihenfolge fürs Tier-Limit-Gating (älteste zuerst).
 */
export async function listPortalVendorKeysForCron(): Promise<
  Array<{ vendorKey: string; organizationId: string; updatedAt: string | null }>
> {
  const rows = await sql<{ vendorKey: string; organizationId: string; createdAt: string | null }[]>`
    SELECT owner_id AS "vendorKey", organization_id AS "organizationId", MIN(created_at) AS "createdAt"
    FROM credential_refs
    WHERE scope = 'portal' AND organization_id IS NOT NULL AND owner_id IS NOT NULL
    GROUP BY owner_id, organization_id
  `;
  return rows.map((r) => ({
    vendorKey: r.vendorKey,
    organizationId: r.organizationId,
    updatedAt: r.createdAt,
  }));
}

/**
 * Listet die Online-Konten EINER Org auf:
 * - Eintrag in der org-eigenen credential-meta-Map (Username vorhanden)
 * - zugehörige Vendor-Stammdaten (Login-URL, Kategorie)
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

export async function listOnlineAccounts(
  organizationId: string | null | undefined,
): Promise<OnlineAccount[]> {
  const meta = await getPortalCredentialMetaMap(organizationId);
  const vendorKeys = Object.keys(meta);
  if (vendorKeys.length === 0) return [];

  const rows = await sql<
    Array<{
      vendorId: number;
      vendorName: string;
      vendorKey: string;
      loginUrl: string | null;
      category: string | null;
    }>
  >`
    SELECT id AS "vendorId", name AS "vendorName", canonical_key AS "vendorKey",
      portal_login_url AS "loginUrl", portal_category AS category
    FROM vendors WHERE canonical_key = ANY(${vendorKeys}::text[])
    ORDER BY name
  `;

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
