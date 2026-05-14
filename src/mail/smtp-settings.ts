import type Database from "better-sqlite3";
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

export function getStoredSmtpAccounts(db?: Database.Database) {
  return readJsonSetting<Record<string, StoredSmtpAccount>>(settingKey, {}, db);
}

export function getStoredSmtpAccount(ownerId: SmtpCredentialOwnerId, db?: Database.Database) {
  return getStoredSmtpAccounts(db)[ownerId];
}

export function saveStoredSmtpAccount(
  ownerId: SmtpCredentialOwnerId,
  account: Omit<StoredSmtpAccount, "updatedAt">,
  db?: Database.Database,
) {
  const accounts = getStoredSmtpAccounts(db);
  accounts[ownerId] = {
    ...account,
    updatedAt: new Date().toISOString(),
  };
  writeJsonSetting(settingKey, accounts, db);
}
