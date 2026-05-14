import crypto from "node:crypto";
import { sql } from "@/lib/db/client";
import {
  deleteOsSecret,
  isOsKeychainSupported,
  readOsSecret,
  writeOsSecret,
} from "@/lib/secrets/os-keychain";
import {
  deleteDbSecret,
  isDbStoreAvailable,
  readDbSecret,
  writeDbSecret,
} from "@/lib/secrets/encrypted-db-store";

export type CredentialScope =
  | "imap"
  | "smtp"
  | "portal"
  | "mistral"
  | "totp"
  | "lexoffice"
  | "sevdesk"
  | "datev";

// Integration-Scopes umgehen die credential_refs-Tabelle (CHECK-Constraint).
// Token-Status wird in integration_targets getrackt; der eigentliche Token liegt im Secret-Store.
const INTEGRATION_SCOPES = new Set<CredentialScope>(["lexoffice", "sevdesk", "datev"]);

export function buildSecretRef(
  scope: CredentialScope,
  ownerId = "default",
  organizationId?: string | null,
) {
  const key = organizationId
    ? `${scope}:${organizationId}:${ownerId}`
    : `${scope}:${ownerId}`;
  const digest = crypto.createHash("sha256").update(key).digest("hex").slice(0, 16);
  return `invoice-agent:${scope}:${digest}`;
}

export function maskIdentifier(value: string) {
  const trimmed = value.trim();
  if (trimmed.length <= 4) return "****";
  if (trimmed.includes("@")) {
    const [name, domain] = trimmed.split("@");
    return `${name.slice(0, 2)}***@${domain}`;
  }
  return `${trimmed.slice(0, 2)}***${trimmed.slice(-2)}`;
}

/**
 * True wenn mindestens ein Secret-Store verfügbar ist (macOS Keychain oder Encrypted-DB-Store).
 */
export function isSecretStoreAvailable() {
  return isOsKeychainSupported() || isDbStoreAvailable();
}

type StoreName = "os_keychain" | "encrypted_db";

/**
 * Gibt den aktiven Store zurück.
 * Priorität: macOS Keychain (darwin) > Supabase Vault (immer verfügbar in Supabase Cloud).
 * Wirft nur wenn beide nicht verfügbar sind (sollte im normalen Betrieb nie passieren).
 */
function getActiveStoreName(): StoreName {
  if (isOsKeychainSupported()) return "os_keychain";
  if (isDbStoreAvailable()) return "encrypted_db";
  throw new Error(
    "Kein Secret Store verfügbar. " +
    "Stelle sicher dass das Projekt mit Supabase Vault (pgsodium) verbunden ist.",
  );
}

async function writeToStore(
  storeName: StoreName,
  secretRef: string,
  secret: string,
): Promise<void> {
  if (storeName === "os_keychain") {
    await writeOsSecret(secretRef, secret);
  } else {
    await writeDbSecret(secretRef, secret);
  }
}

async function readFromStore(
  storeName: StoreName,
  secretRef: string,
): Promise<string | null> {
  if (storeName === "os_keychain") return readOsSecret(secretRef);
  return readDbSecret(secretRef);
}

async function deleteFromStore(
  storeName: StoreName,
  secretRef: string,
): Promise<void> {
  if (storeName === "os_keychain") {
    await deleteOsSecret(secretRef);
  } else {
    await deleteDbSecret(secretRef);
  }
}

export async function saveCredentialSecret(input: {
  scope: CredentialScope;
  ownerId?: string;
  organizationId?: string | null;
  label: string;
  secret: string;
}) {
  const ownerId = input.ownerId || "default";
  const secretRef = buildSecretRef(input.scope, ownerId, input.organizationId);

  if (!input.secret.trim()) {
    throw new Error("Secret darf nicht leer sein.");
  }

  const storeName = getActiveStoreName();
  await writeToStore(storeName, secretRef, input.secret);

  if (!INTEGRATION_SCOPES.has(input.scope)) {
    await sql`
      INSERT INTO credential_refs (scope, owner_id, label, secret_store, secret_ref, status, last_verified_at, organization_id)
      VALUES (
        ${input.scope}, ${ownerId}, ${input.label}, ${storeName}, ${secretRef},
        'configured', CURRENT_TIMESTAMP, ${input.organizationId ?? null}
      )
      ON CONFLICT(secret_ref) DO UPDATE SET
        scope            = excluded.scope,
        owner_id         = excluded.owner_id,
        label            = excluded.label,
        secret_store     = excluded.secret_store,
        status           = 'configured',
        last_verified_at = CURRENT_TIMESTAMP,
        organization_id  = excluded.organization_id,
        updated_at       = CURRENT_TIMESTAMP
    `;
  }

  return secretRef;
}

export async function deleteCredentialSecret(input: {
  scope: CredentialScope;
  ownerId?: string;
  organizationId?: string | null;
}) {
  const ownerId = input.ownerId || "default";
  const secretRef = buildSecretRef(input.scope, ownerId, input.organizationId);

  if (INTEGRATION_SCOPES.has(input.scope)) {
    // Integration-Scopes haben keinen credential_refs-Eintrag — beide Stores bereinigen.
    await deleteOsSecret(secretRef);
    await deleteDbSecret(secretRef);
    return;
  }

  // Nachschlagen welcher Store beim Speichern verwendet wurde.
  const rows = await sql<{ secret_store: StoreName }[]>`
    SELECT secret_store FROM credential_refs WHERE secret_ref = ${secretRef} LIMIT 1
  `;
  const row = rows[0];

  const storeName: StoreName = row?.secret_store ?? getActiveStoreName();
  await deleteFromStore(storeName, secretRef);
  await sql`DELETE FROM credential_refs WHERE secret_ref = ${secretRef}`;
}

export async function readCredentialSecret(input: {
  scope: CredentialScope;
  ownerId?: string;
  organizationId?: string | null;
}) {
  if (input.scope === "mistral" && process.env.MISTRAL_API_KEY) {
    return process.env.MISTRAL_API_KEY;
  }

  const ownerId = input.ownerId || "default";
  const secretRef = buildSecretRef(input.scope, ownerId, input.organizationId);

  if (INTEGRATION_SCOPES.has(input.scope)) {
    // Kein credential_refs-Eintrag — beide Stores versuchen (OS zuerst für Rückwärts-Kompatibilität).
    const fromOs = await readOsSecret(secretRef);
    if (fromOs !== null) return fromOs;
    return readDbSecret(secretRef);
  }

  const rows = await sql<{ status: string; secret_store: StoreName }[]>`
    SELECT status, secret_store
    FROM credential_refs
    WHERE secret_ref = ${secretRef}
    LIMIT 1
  `;
  const row = rows[0];

  if (!row) return null;

  return readFromStore(row.secret_store, secretRef);
}

export async function updateCredentialVerificationStatus(input: {
  scope: CredentialScope;
  ownerId?: string;
  organizationId?: string | null;
  status: "configured" | "missing" | "invalid" | "locked";
}): Promise<void> {
  const ownerId = input.ownerId || "default";
  const secretRef = buildSecretRef(input.scope, ownerId, input.organizationId);

  await sql`
    UPDATE credential_refs
    SET status = ${input.status}, last_verified_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP
    WHERE secret_ref = ${secretRef}
  `;
}

export async function hasConfiguredCredential(
  scope: CredentialScope,
  ownerId = "default",
  organizationId?: string | null,
): Promise<boolean> {
  if (scope === "mistral" && process.env.MISTRAL_API_KEY) return true;

  const secretRef = buildSecretRef(scope, ownerId, organizationId);
  const rows = await sql<{ id: number }[]>`
    SELECT id
    FROM credential_refs
    WHERE secret_ref = ${secretRef} AND status = 'configured'
    LIMIT 1
  `;

  return rows.length > 0;
}

export async function hasStoredCredentialRef(
  scope: CredentialScope,
  ownerId = "default",
  organizationId?: string | null,
): Promise<boolean> {
  if (scope === "mistral" && process.env.MISTRAL_API_KEY) return true;

  const secretRef = buildSecretRef(scope, ownerId, organizationId);
  const rows = await sql<{ id: number }[]>`
    SELECT id
    FROM credential_refs
    WHERE secret_ref = ${secretRef}
    LIMIT 1
  `;

  return rows.length > 0;
}

export async function getCredentialLastVerifiedAt(
  scope: CredentialScope,
  ownerId = "default",
  organizationId?: string | null,
): Promise<string | null> {
  const secretRef = buildSecretRef(scope, ownerId, organizationId);
  const rows = await sql<{ lastVerifiedAt: string | null }[]>`
    SELECT last_verified_at AS "lastVerifiedAt"
    FROM credential_refs
    WHERE secret_ref = ${secretRef}
    LIMIT 1
  `;
  return rows[0]?.lastVerifiedAt ?? null;
}
