import crypto from "node:crypto";
import type Database from "better-sqlite3";
import { getDb } from "@/lib/db/client";
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
 * Priorität: macOS Keychain (darwin) > Encrypted-DB-Store (SECRET_ENCRYPTION_KEY gesetzt).
 * Wirft wenn keiner verfügbar ist — verhindert stille Datenverluste.
 */
function getActiveStoreName(): StoreName {
  if (isOsKeychainSupported()) return "os_keychain";
  if (isDbStoreAvailable()) return "encrypted_db";
  throw new Error(
    "Kein Secret Store verfügbar. " +
    "Bitte SECRET_ENCRYPTION_KEY als Umgebungsvariable setzen (openssl rand -hex 32).",
  );
}

async function writeToStore(
  storeName: StoreName,
  secretRef: string,
  secret: string,
  db: Database.Database,
): Promise<void> {
  if (storeName === "os_keychain") {
    await writeOsSecret(secretRef, secret);
  } else {
    writeDbSecret(secretRef, secret, db);
  }
}

async function readFromStore(
  storeName: StoreName,
  secretRef: string,
  db: Database.Database,
): Promise<string | null> {
  if (storeName === "os_keychain") return readOsSecret(secretRef);
  return readDbSecret(secretRef, db);
}

async function deleteFromStore(
  storeName: StoreName,
  secretRef: string,
  db: Database.Database,
): Promise<void> {
  if (storeName === "os_keychain") {
    await deleteOsSecret(secretRef);
  } else {
    deleteDbSecret(secretRef, db);
  }
}

export async function saveCredentialSecret(input: {
  scope: CredentialScope;
  ownerId?: string;
  organizationId?: string | null;
  label: string;
  secret: string;
  db?: Database.Database;
}) {
  const db = input.db || getDb();
  const ownerId = input.ownerId || "default";
  const secretRef = buildSecretRef(input.scope, ownerId, input.organizationId);

  if (!input.secret.trim()) {
    throw new Error("Secret darf nicht leer sein.");
  }

  const storeName = getActiveStoreName();
  await writeToStore(storeName, secretRef, input.secret, db);

  if (!INTEGRATION_SCOPES.has(input.scope)) {
    db.prepare(
      `INSERT INTO credential_refs (scope, owner_id, label, secret_store, secret_ref, status, last_verified_at, organization_id)
       VALUES (?, ?, ?, ?, ?, 'configured', CURRENT_TIMESTAMP, ?)
       ON CONFLICT(secret_ref) DO UPDATE SET
         scope            = excluded.scope,
         owner_id         = excluded.owner_id,
         label            = excluded.label,
         secret_store     = excluded.secret_store,
         status           = 'configured',
         last_verified_at = CURRENT_TIMESTAMP,
         organization_id  = excluded.organization_id,
         updated_at       = CURRENT_TIMESTAMP`,
    ).run(input.scope, ownerId, input.label, storeName, secretRef, input.organizationId ?? null);
  }

  return secretRef;
}

export async function deleteCredentialSecret(input: {
  scope: CredentialScope;
  ownerId?: string;
  organizationId?: string | null;
  db?: Database.Database;
}) {
  const db = input.db || getDb();
  const ownerId = input.ownerId || "default";
  const secretRef = buildSecretRef(input.scope, ownerId, input.organizationId);

  if (INTEGRATION_SCOPES.has(input.scope)) {
    // Integration-Scopes haben keinen credential_refs-Eintrag — beide Stores bereinigen.
    await deleteOsSecret(secretRef);
    deleteDbSecret(secretRef, db);
    return;
  }

  // Nachschlagen welcher Store beim Speichern verwendet wurde.
  const row = db
    .prepare(`SELECT secret_store FROM credential_refs WHERE secret_ref = ? LIMIT 1`)
    .get(secretRef) as { secret_store: StoreName } | undefined;

  const storeName: StoreName = row?.secret_store ?? getActiveStoreName();
  await deleteFromStore(storeName, secretRef, db);
  db.prepare(`DELETE FROM credential_refs WHERE secret_ref = ?`).run(secretRef);
}

export async function readCredentialSecret(input: {
  scope: CredentialScope;
  ownerId?: string;
  organizationId?: string | null;
  db?: Database.Database;
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

  const db = input.db || getDb();
  const row = db
    .prepare(
      `SELECT status, secret_store
       FROM credential_refs
       WHERE secret_ref = ?
       LIMIT 1`,
    )
    .get(secretRef) as { status: string; secret_store: StoreName } | undefined;

  if (!row) return null;

  return readFromStore(row.secret_store, secretRef, db);
}

export function updateCredentialVerificationStatus(input: {
  scope: CredentialScope;
  ownerId?: string;
  organizationId?: string | null;
  status: "configured" | "missing" | "invalid" | "locked";
  db?: Database.Database;
}) {
  const db = input.db || getDb();
  const ownerId = input.ownerId || "default";
  const secretRef = buildSecretRef(input.scope, ownerId, input.organizationId);

  db.prepare(
    `UPDATE credential_refs
     SET status = ?, last_verified_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP
     WHERE secret_ref = ?`,
  ).run(input.status, secretRef);
}

export function hasConfiguredCredential(db: Database.Database, scope: CredentialScope, ownerId = "default", organizationId?: string | null) {
  if (scope === "mistral" && process.env.MISTRAL_API_KEY) return true;

  const secretRef = buildSecretRef(scope, ownerId, organizationId);
  const row = db
    .prepare(
      `SELECT id
       FROM credential_refs
       WHERE secret_ref = ? AND status = 'configured'
       LIMIT 1`,
    )
    .get(secretRef) as { id: number } | undefined;

  return Boolean(row);
}

export function hasStoredCredentialRef(db: Database.Database, scope: CredentialScope, ownerId = "default", organizationId?: string | null) {
  if (scope === "mistral" && process.env.MISTRAL_API_KEY) return true;

  const secretRef = buildSecretRef(scope, ownerId, organizationId);
  const row = db
    .prepare(
      `SELECT id
       FROM credential_refs
       WHERE secret_ref = ?
       LIMIT 1`,
    )
    .get(secretRef) as { id: number } | undefined;

  return Boolean(row);
}

export function getCredentialLastVerifiedAt(
  db: Database.Database,
  scope: CredentialScope,
  ownerId = "default",
  organizationId?: string | null,
): string | null {
  const secretRef = buildSecretRef(scope, ownerId, organizationId);
  const row = db
    .prepare(
      `SELECT last_verified_at AS lastVerifiedAt
       FROM credential_refs
       WHERE secret_ref = ?
       LIMIT 1`,
    )
    .get(secretRef) as { lastVerifiedAt: string | null } | undefined;
  return row?.lastVerifiedAt ?? null;
}
