import { ImapFlow } from "imapflow";
import type Database from "better-sqlite3";
import { getDb } from "@/lib/db/client";
import {
  readCredentialSecret,
  updateCredentialVerificationStatus,
} from "@/lib/secrets/credential-store";
import type { ImapCredentialOwnerId, ImapMailAccountLabel } from "@/mail/imap-account-slots";
import {
  IMAP_MAIL_ACCOUNT_SLOTS,
  imapCredentialOwnerIdForLabel,
} from "@/mail/imap-account-slots";

export type PrimaryImapAccount = {
  id: number;
  host: string;
  port: number;
  secure: number;
  username: string;
  /** Set for multi-mailbox setups; inferred as Primary when missing (e.g. tests). */
  label?: ImapMailAccountLabel;
};

export type ConfiguredImapAccount = PrimaryImapAccount & {
  label: ImapMailAccountLabel;
  credentialOwnerId: ImapCredentialOwnerId;
  organizationId?: string | null;
};

export function listConfiguredImapAccounts(db: Database.Database = getDb()) {
  const placeholders = IMAP_MAIL_ACCOUNT_SLOTS.map(() => "?").join(", ");
  const labels = IMAP_MAIL_ACCOUNT_SLOTS.map((s) => s.label);
  const rows = db
    .prepare(
      `SELECT id, label, host, port, secure, username, organization_id
       FROM mail_accounts
       WHERE label IN (${placeholders}) AND status = 'configured'
       ORDER BY id ASC`,
    )
    .all(...labels) as Array<
    Omit<PrimaryImapAccount, "label"> & { label: string; organization_id: string | null }
  >;

  const ordered: ConfiguredImapAccount[] = [];
  for (const slot of IMAP_MAIL_ACCOUNT_SLOTS) {
    const row = rows.find((r) => r.label === slot.label);
    if (!row) continue;
    ordered.push({
      ...row,
      label: row.label as ImapMailAccountLabel,
      credentialOwnerId: slot.ownerId,
      organizationId: row.organization_id,
    });
  }
  return ordered;
}

export async function createImapClientForAccount(
  account: ConfiguredImapAccount,
  db: Database.Database = getDb(),
) {
  const ownerId = imapCredentialOwnerIdForLabel(account.label);
  if (!ownerId) {
    throw new Error("Unbekanntes IMAP-Postfach-Label.");
  }

  const password = await readCredentialSecret({ scope: "imap", ownerId, organizationId: account.organizationId, db });
  if (!password) {
    throw new Error(`IMAP-Passwort fehlt im Secret Store (${account.label}).`);
  }

  return {
    account,
    client: new ImapFlow({
      host: account.host,
      port: account.port,
      secure: Boolean(account.secure),
      auth: {
        user: account.username,
        pass: password,
      },
      logger: false,
    }),
  };
}

/** @deprecated Prefer listConfiguredImapAccounts + createImapClientForAccount */
export async function createPrimaryImapClient(db: Database.Database = getDb()) {
  const accounts = listConfiguredImapAccounts(db);
  const first = accounts[0];
  if (!first) {
    throw new Error("Kein konfiguriertes IMAP-Postfach vorhanden.");
  }
  return createImapClientForAccount(first, db);
}

export async function verifyImapAccountConnection(
  slotOwnerId: ImapCredentialOwnerId,
  db: Database.Database = getDb(),
  organizationId?: string | null,
) {
  const slot = IMAP_MAIL_ACCOUNT_SLOTS.find((entry) => entry.ownerId === slotOwnerId);
  if (!slot) {
    throw new Error("Unbekanntes IMAP-Postfach.");
  }

  const account = db
    .prepare(
      `SELECT id, label, host, port, secure, username, organization_id
       FROM mail_accounts
       WHERE label = ?
       ORDER BY id DESC
       LIMIT 1`,
    )
    .get(slot.label) as (ConfiguredImapAccount & { organization_id?: string | null }) | undefined;

  if (!account) {
    throw new Error(`${slot.label} ist noch nicht konfiguriert.`);
  }

  const resolvedOrganizationId = organizationId ?? account.organization_id ?? null;

  let createdClient: Awaited<ReturnType<typeof createImapClientForAccount>> | null = null;

  try {
    createdClient = await createImapClientForAccount(
      {
        ...account,
        label: slot.label,
        credentialOwnerId: slot.ownerId,
        organizationId: resolvedOrganizationId,
      },
      db,
    );

    await createdClient.client.connect();
    const lock = await createdClient.client.getMailboxLock("INBOX");
    lock.release();

    updateCredentialVerificationStatus({
      db,
      scope: "imap",
      ownerId: slot.ownerId,
      organizationId: resolvedOrganizationId,
      status: "configured",
    });
    db.prepare(
      `UPDATE mail_accounts
       SET status = 'configured', last_verified_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP
       WHERE id = ?`,
    ).run(account.id);

    return {
      label: slot.label,
      host: account.host,
      username: account.username,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : "IMAP-Verbindung fehlgeschlagen.";
    if (looksLikeImapCredentialError(message)) {
      updateCredentialVerificationStatus({
        db,
        scope: "imap",
        ownerId: slot.ownerId,
        organizationId: resolvedOrganizationId,
        status: "invalid",
      });
      db.prepare(
        `UPDATE mail_accounts
         SET status = 'invalid', updated_at = CURRENT_TIMESTAMP
         WHERE id = ?`,
      ).run(account.id);
    }
    throw new Error(normalizeImapVerificationError(message, slot.label));
  } finally {
    await logoutImapClient(createdClient?.client || null);
  }
}

async function logoutImapClient(client: { logout(): Promise<unknown> } | null) {
  if (!client) return;
  try {
    await client.logout();
  } catch {
    // Connection teardown should not mask the actual verification result.
  }
}

function looksLikeImapCredentialError(message: string) {
  const normalized = message.toLowerCase();
  return (
    normalized.includes("auth") ||
    normalized.includes("invalid credentials") ||
    normalized.includes("login failed") ||
    normalized.includes("authentication failed") ||
    normalized.includes("username") ||
    normalized.includes("password")
  );
}

function normalizeImapVerificationError(message: string, label: string) {
  if (message.includes("Passwort fehlt")) return message;
  return `${label}: ${message}`;
}
