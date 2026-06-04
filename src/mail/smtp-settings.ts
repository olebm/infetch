import { readJsonSetting, writeJsonSetting } from "@/lib/db/settings-store";
import type { SmtpCredentialOwnerId } from "@/mail/smtp-account-slots";

export type StoredSmtpAccount = {
  host: string;
  port: number;
  secure: boolean;
  username: string;
  fromAddress: string;
  updatedAt: string;
};

const settingKey = "smtp_accounts";

export async function getStoredSmtpAccounts(): Promise<Record<string, StoredSmtpAccount>> {
  return readJsonSetting<Record<string, StoredSmtpAccount>>(settingKey, {});
}

export async function getStoredSmtpAccount(
  ownerId: SmtpCredentialOwnerId,
): Promise<StoredSmtpAccount | undefined> {
  return (await getStoredSmtpAccounts())[ownerId];
}

export async function saveStoredSmtpAccount(
  ownerId: SmtpCredentialOwnerId,
  account: Omit<StoredSmtpAccount, "updatedAt">,
): Promise<void> {
  const accounts = await getStoredSmtpAccounts();
  accounts[ownerId] = {
    ...account,
    updatedAt: new Date().toISOString(),
  };
  await writeJsonSetting(settingKey, accounts);
}

/**
 * Entfernt ein gespeichertes Absende-Konto (Gegenstück zu
 * {@link saveStoredSmtpAccount}). No-op, wenn der Slot nicht existiert.
 */
export async function removeStoredSmtpAccount(ownerId: SmtpCredentialOwnerId): Promise<void> {
  const accounts = await getStoredSmtpAccounts();
  if (!(ownerId in accounts)) return;
  delete accounts[ownerId];
  await writeJsonSetting(settingKey, accounts);
}
