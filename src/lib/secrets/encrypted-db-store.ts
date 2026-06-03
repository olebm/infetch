/**
 * Supabase Vault Secret Store für Infetch.
 *
 * Ersetzt den AES-256-GCM Encrypted-DB-Store.  Secrets werden via Supabase Vault
 * (pgsodium Extension) serverseitig verschlüsselt gespeichert — kein eigener
 * SECRET_ENCRYPTION_KEY mehr nötig, Supabase verwaltet die Schlüssel.
 *
 * Vault-API (Postgres-Seite):
 *   vault.create_secret(secret text, name text)  → uuid
 *   vault.decrypted_secrets                      → view (name, decrypted_secret, …)
 *   vault.secrets                                → raw-Tabelle (name, secret, …)
 *
 * Aufruf-Muster:
 *   Write:  DELETE WHERE name + vault.create_secret()   (Upsert ohne nativen ON CONFLICT)
 *   Read:   SELECT … FROM vault.decrypted_secrets WHERE name = …
 *   Delete: DELETE FROM vault.secrets WHERE name = …
 */

import { unsafeGlobalSql as sql } from "@/lib/db/unsafe-global";

/**
 * Gibt an ob der Vault-Store verfügbar ist.
 * Supabase Vault (pgsodium) ist in jedem Supabase-Projekt immer aktiv → true.
 */
export function isDbStoreAvailable(): boolean {
  return true;
}

/**
 * Speichert `secret` in Supabase Vault unter dem Schlüssel `secretRef`.
 * Überschreibt einen vorhandenen Eintrag (DELETE then CREATE — Vault hat kein natives Upsert).
 */
export async function writeDbSecret(secretRef: string, secret: string): Promise<void> {
  // Alten Eintrag entfernen (kein Fehler wenn nicht vorhanden)
  await sql`DELETE FROM vault.secrets WHERE name = ${secretRef}`;
  // Neu anlegen — Vault verschlüsselt mit dem projekteigenen pgsodium-Key
  await sql`SELECT vault.create_secret(${secret}, ${secretRef})`;
}

/**
 * Liest und entschlüsselt einen Secret aus Supabase Vault.
 * Gibt null zurück wenn kein Eintrag unter `secretRef` vorhanden ist.
 */
export async function readDbSecret(secretRef: string): Promise<string | null> {
  const rows = await sql<{ decryptedSecret: string }[]>`
    SELECT decrypted_secret AS "decryptedSecret"
    FROM vault.decrypted_secrets
    WHERE name = ${secretRef}
    LIMIT 1
  `;
  return rows[0]?.decryptedSecret ?? null;
}

/**
 * Löscht einen Secret aus Supabase Vault. Kein Fehler wenn nicht vorhanden.
 */
export async function deleteDbSecret(secretRef: string): Promise<void> {
  await sql`DELETE FROM vault.secrets WHERE name = ${secretRef}`;
}
