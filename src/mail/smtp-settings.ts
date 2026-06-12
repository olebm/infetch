import { readOrgJsonSetting, writeOrgJsonSetting } from "@/lib/db/settings-store";
import type { SmtpCredentialOwnerId } from "@/mail/smtp-account-slots";

export type StoredSmtpAccount = {
  host: string;
  port: number;
  secure: boolean;
  username: string;
  fromAddress: string;
  updatedAt: string;
};

// INFETCH-280: Absende-Konten sind org-gescopt (`smtp_accounts:${orgId}`). Vorher
// EIN globaler Key für alle Mandanten — eine Org überschrieb das Absende-Konto
// (Host/Port/From) einer anderen → Versand über den falschen Server. Der
// Legacy-Global-Fallback von readOrgJsonSetting bewahrt Bestandswerte, bis eine
// Org einmal speichert (dann wird die Map org-isoliert geschnappt).
const settingKey = "smtp_accounts";

export async function getStoredSmtpAccounts(
  organizationId: string | null | undefined,
): Promise<Record<string, StoredSmtpAccount>> {
  return readOrgJsonSetting<Record<string, StoredSmtpAccount>>(settingKey, organizationId, {});
}

export async function getStoredSmtpAccount(
  ownerId: SmtpCredentialOwnerId,
  organizationId: string | null | undefined,
): Promise<StoredSmtpAccount | undefined> {
  return (await getStoredSmtpAccounts(organizationId))[ownerId];
}

export async function saveStoredSmtpAccount(
  ownerId: SmtpCredentialOwnerId,
  account: Omit<StoredSmtpAccount, "updatedAt">,
  organizationId: string | null | undefined,
): Promise<void> {
  const accounts = await getStoredSmtpAccounts(organizationId);
  accounts[ownerId] = {
    ...account,
    updatedAt: new Date().toISOString(),
  };
  await writeOrgJsonSetting(settingKey, organizationId, accounts);
}

/**
 * Entfernt ein gespeichertes Absende-Konto (Gegenstück zu
 * {@link saveStoredSmtpAccount}). No-op, wenn der Slot nicht existiert.
 */
export async function removeStoredSmtpAccount(
  ownerId: SmtpCredentialOwnerId,
  organizationId: string | null | undefined,
): Promise<void> {
  const accounts = await getStoredSmtpAccounts(organizationId);
  if (!(ownerId in accounts)) return;
  delete accounts[ownerId];
  await writeOrgJsonSetting(settingKey, organizationId, accounts);
}
