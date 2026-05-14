/**
 * AES-256-GCM Credential Store auf SQLite-Basis (INFETCH-XX).
 *
 * Wird als Fallback verwendet wenn kein macOS Keychain verfügbar ist (Linux, Docker).
 * Setzt SECRET_ENCRYPTION_KEY als Umgebungsvariable voraus — ein 64-Zeichen-Hex-String
 * (= 32 Bytes), erzeugt mit: `openssl rand -hex 32`
 *
 * Gespeichertes Format in encrypted_secrets.ciphertext:
 *   {iv_hex}:{authTag_hex}:{ciphertext_hex}
 *
 * Sicherheits-Eigenschaften:
 * - AES-256-GCM: Authenticated Encryption — erkennt Manipulation am Ciphertext.
 * - Zufälliger 96-bit IV pro Schreib-Operation — kein IV-Wiederverwendungs-Problem.
 * - 128-bit Auth-Tag — standardmäßige GCM-Stärke.
 * - Key nie in der DB — liegt nur in der Umgebungsvariable.
 */

import crypto from "node:crypto";
import type Database from "better-sqlite3";
import { getDb } from "@/lib/db/client";

const ALGORITHM = "aes-256-gcm" as const;
const IV_BYTES = 12;    // 96 Bit — optimal für GCM
const TAG_BYTES = 16;   // 128 Bit — GCM-Standard

function getEncryptionKey(): Buffer {
  const hex = process.env.SECRET_ENCRYPTION_KEY?.trim();
  if (!hex) {
    throw new Error(
      "SECRET_ENCRYPTION_KEY ist nicht konfiguriert. " +
      "Bitte einen 64-stelligen Hex-String (openssl rand -hex 32) als Umgebungsvariable setzen.",
    );
  }
  const key = Buffer.from(hex, "hex");
  if (key.length !== 32) {
    throw new Error(
      `SECRET_ENCRYPTION_KEY muss exakt 64 Hex-Zeichen (32 Bytes) lang sein, hat aber ${hex.length} Zeichen.`,
    );
  }
  return key;
}

/**
 * Gibt an ob der DB-Encrypted-Store verfügbar ist.
 * Muss SECRET_ENCRYPTION_KEY gesetzt haben.
 */
export function isDbStoreAvailable(): boolean {
  return Boolean(process.env.SECRET_ENCRYPTION_KEY?.trim());
}

/**
 * Verschlüsselt `secret` mit AES-256-GCM und speichert das Ergebnis in der DB.
 * Überschreibt einen vorhandenen Eintrag für `secretRef`.
 */
export function writeDbSecret(
  secretRef: string,
  secret: string,
  db?: Database.Database,
): void {
  const key = getEncryptionKey();
  const iv = crypto.randomBytes(IV_BYTES);
  const cipher = crypto.createCipheriv(ALGORITHM, key, iv);

  const ciphertext = Buffer.concat([cipher.update(secret, "utf8"), cipher.final()]);
  const authTag = cipher.getAuthTag();

  if (authTag.length !== TAG_BYTES) {
    throw new Error(`Unerwartete Auth-Tag-Länge: ${authTag.length}`);
  }

  // Format: iv_hex:authTag_hex:ciphertext_hex
  const stored = `${iv.toString("hex")}:${authTag.toString("hex")}:${ciphertext.toString("hex")}`;

  (db ?? getDb())
    .prepare(
      `INSERT INTO encrypted_secrets (secret_ref, ciphertext)
       VALUES (?, ?)
       ON CONFLICT(secret_ref) DO UPDATE SET
         ciphertext  = excluded.ciphertext,
         updated_at  = CURRENT_TIMESTAMP`,
    )
    .run(secretRef, stored);
}

/**
 * Liest und entschlüsselt einen Secret aus der DB.
 * Gibt null zurück wenn der Eintrag nicht gefunden wird oder die Entschlüsselung fehlschlägt.
 */
export function readDbSecret(
  secretRef: string,
  db?: Database.Database,
): string | null {
  const row = (db ?? getDb())
    .prepare(`SELECT ciphertext FROM encrypted_secrets WHERE secret_ref = ? LIMIT 1`)
    .get(secretRef) as { ciphertext: string } | undefined;

  if (!row) return null;

  let key: Buffer;
  try {
    key = getEncryptionKey();
  } catch {
    // Key nicht konfiguriert — kann nicht entschlüsseln.
    return null;
  }

  const parts = row.ciphertext.split(":");
  if (parts.length !== 3) return null;

  try {
    const iv         = Buffer.from(parts[0], "hex");
    const authTag    = Buffer.from(parts[1], "hex");
    const ciphertext = Buffer.from(parts[2], "hex");

    const decipher = crypto.createDecipheriv(ALGORITHM, key, iv);
    decipher.setAuthTag(authTag);

    const plaintext = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
    return plaintext.toString("utf8");
  } catch {
    // Entschlüsselung fehlgeschlagen — falscher Key oder manipulierte Daten.
    return null;
  }
}

/**
 * Löscht einen Secret aus der DB. Kein Fehler wenn nicht vorhanden.
 */
export function deleteDbSecret(
  secretRef: string,
  db?: Database.Database,
): void {
  (db ?? getDb())
    .prepare(`DELETE FROM encrypted_secrets WHERE secret_ref = ?`)
    .run(secretRef);
}
