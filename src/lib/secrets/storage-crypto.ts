/**
 * At-Rest-Verschlüsselung für Storage-Objekte (Rechnungs-PDFs, Rohtext,
 * Portal-Sessions).
 *
 * AES-256-GCM mit einem Master-Key, der in Supabase Vault liegt (gleiche
 * Vertrauensbasis wie die übrigen Secrets). Der Key wird bei Erstnutzung
 * einmalig generiert und gecached.
 *
 * Envelope-Format (Buffer):
 *   [ MAGIC(4) | IV(12) | AUTH_TAG(16) | CIPHERTEXT(n) ]
 *
 * Fehlt der MAGIC-Header, gilt das Objekt als unverschlüsselter Legacy-Inhalt
 * und wird unverändert durchgereicht — so bleiben bereits gespeicherte Dateien
 * lesbar, ohne Migration.
 */

import crypto from "node:crypto";
import { readDbSecret, writeDbSecret } from "@/lib/secrets/encrypted-db-store";

const MAGIC = Buffer.from("IFE1", "ascii"); // Infetch Encrypted v1
const IV_LEN = 12;
const TAG_LEN = 16;
const KEY_LEN = 32;
const STORAGE_KEY_REF = "infetch:storage-master-key";

let cachedKey: Buffer | null = null;

/**
 * Holt den Storage-Master-Key aus Vault; generiert ihn bei Erstnutzung.
 * Ergebnis wird prozessweit gecached.
 */
export async function getStorageKey(): Promise<Buffer> {
  if (cachedKey) return cachedKey;

  const existing = await readDbSecret(STORAGE_KEY_REF);
  if (existing) {
    const key = Buffer.from(existing, "base64");
    if (key.length !== KEY_LEN) {
      throw new Error("Storage-Master-Key hat ungültige Länge.");
    }
    cachedKey = key;
    return key;
  }

  const key = crypto.randomBytes(KEY_LEN);
  await writeDbSecret(STORAGE_KEY_REF, key.toString("base64"));
  cachedKey = key;
  return key;
}

/** True, wenn der Buffer ein Infetch-Envelope ist (sonst Legacy-Klartext). */
export function isEncrypted(data: Buffer): boolean {
  return data.length >= MAGIC.length && data.subarray(0, MAGIC.length).equals(MAGIC);
}

export function encryptBuffer(plain: Buffer, key: Buffer): Buffer {
  const iv = crypto.randomBytes(IV_LEN);
  const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
  const ciphertext = Buffer.concat([cipher.update(plain), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return Buffer.concat([MAGIC, iv, authTag, ciphertext]);
}

/**
 * Entschlüsselt einen Envelope. Ist der Buffer kein Envelope (Legacy-Klartext),
 * wird er unverändert zurückgegeben. Bei manipuliertem Inhalt wirft GCM.
 */
export function decryptBuffer(data: Buffer, key: Buffer): Buffer {
  if (!isEncrypted(data)) return data;

  const ivStart = MAGIC.length;
  const tagStart = ivStart + IV_LEN;
  const ctStart = tagStart + TAG_LEN;
  if (data.length < ctStart) {
    throw new Error("Storage-Envelope ist beschädigt (zu kurz).");
  }

  const iv = data.subarray(ivStart, tagStart);
  const authTag = data.subarray(tagStart, ctStart);
  const ciphertext = data.subarray(ctStart);

  const decipher = crypto.createDecipheriv("aes-256-gcm", key, iv);
  decipher.setAuthTag(authTag);
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]);
}
