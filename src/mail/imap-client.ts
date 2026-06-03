import { ImapFlow } from "imapflow";
import { unsafeGlobalSql as sql } from "@/lib/db/unsafe-global";
import {
  readCredentialSecret,
  updateCredentialVerificationStatus,
} from "@/lib/secrets/credential-store";
import type { ImapCredentialOwnerId, ImapMailAccountLabel } from "@/mail/imap-account-slots";
import { IMAP_MAIL_ACCOUNT_SLOTS, imapCredentialOwnerIdForLabel } from "@/mail/imap-account-slots";

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

/**
 * Configured IMAP accounts, collapsed to one row per slot (Primary/Secondary).
 *
 * - `limitToOrgId` set → only that org's accounts (DB-level filter). This is
 *   the org-scoped scan path (onboarding, manual re-scan, backfill).
 * - `limitToOrgId` omitted → all configured accounts (cron catch-up check).
 *
 * Row selection per slot prefers a non-null `organization_id` over a legacy
 * null-org row (`organization_id IS NULL` sorts last), so a Pre-Multi-Tenant
 * leftover never shadows the real org-scoped row — the exact failure mode that
 * made onboarding scans report "Kein konfiguriertes IMAP-Postfach vorhanden".
 *
 * Mailboxes belonging to a soft-deleted organization are excluded: a deleted
 * org's mailbox lingers (soft-delete only sets organizations.deleted_at, it
 * does not remove mail_accounts) and would otherwise be scanned by the
 * no-filter cron path, shadowing the live org's mailbox.
 */
export async function listConfiguredImapAccounts(
  limitToOrgId?: string | null,
): Promise<ConfiguredImapAccount[]> {
  const labels = IMAP_MAIL_ACCOUNT_SLOTS.map((s) => s.label);
  const rows = await sql<
    Array<Omit<PrimaryImapAccount, "label"> & { label: string; organization_id: string | null }>
  >`
    SELECT id, label, host, port, secure, username, organization_id
    FROM mail_accounts
    WHERE label = ANY(${labels}::text[]) AND status = 'configured'
      AND NOT EXISTS (
        SELECT 1 FROM organizations o
        WHERE o.id = mail_accounts.organization_id AND o.deleted_at IS NOT NULL
      )
    ${limitToOrgId != null ? sql`AND organization_id = ${limitToOrgId}` : sql``}
    ORDER BY (organization_id IS NULL), id ASC
  `;

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

/**
 * Distinct organization IDs that have at least one configured, non-soft-deleted
 * mailbox. The auto-pilot cron iterates this and runs one per-org scan each, so
 * every tenant gets auto-scanned (not just whichever org wins the slot collapse).
 * Legacy null-org mailboxes are intentionally excluded — they are not a tenant.
 */
export async function listOrgsWithConfiguredMailbox(): Promise<string[]> {
  const labels = IMAP_MAIL_ACCOUNT_SLOTS.map((s) => s.label);
  const rows = await sql<{ organizationId: string }[]>`
    SELECT DISTINCT ma.organization_id AS "organizationId"
    FROM mail_accounts ma
    WHERE ma.label = ANY(${labels}::text[])
      AND ma.status = 'configured'
      AND ma.organization_id IS NOT NULL
      AND NOT EXISTS (
        SELECT 1 FROM organizations o
        WHERE o.id = ma.organization_id AND o.deleted_at IS NOT NULL
      )
  `;
  return rows.map((r) => r.organizationId);
}

export async function createImapClientForAccount(account: ConfiguredImapAccount) {
  const ownerId = imapCredentialOwnerIdForLabel(account.label);
  if (!ownerId) {
    throw new Error("Unbekanntes IMAP-Postfach-Label.");
  }

  const password = await readCredentialSecret({
    scope: "imap",
    ownerId,
    organizationId: account.organizationId,
  });
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
export async function createPrimaryImapClient() {
  const accounts = await listConfiguredImapAccounts();
  const first = accounts[0];
  if (!first) {
    throw new Error("Kein konfiguriertes IMAP-Postfach vorhanden.");
  }
  return createImapClientForAccount(first);
}

export async function verifyImapAccountConnection(
  slotOwnerId: ImapCredentialOwnerId,
  organizationId?: string | null,
) {
  const slot = IMAP_MAIL_ACCOUNT_SLOTS.find((entry) => entry.ownerId === slotOwnerId);
  if (!slot) {
    throw new Error("Unbekanntes IMAP-Postfach.");
  }

  const rows = await sql<
    Array<Omit<ConfiguredImapAccount, "credentialOwnerId"> & { organization_id?: string | null }>
  >`
    SELECT id, label, host, port, secure, username, organization_id
    FROM mail_accounts
    WHERE label = ${slot.label}
    ORDER BY id DESC
    LIMIT 1
  `;
  const account = rows[0];

  if (!account) {
    throw new Error(`${slot.label} ist noch nicht konfiguriert.`);
  }

  const resolvedOrganizationId = organizationId ?? account.organization_id ?? null;

  let createdClient: Awaited<ReturnType<typeof createImapClientForAccount>> | null = null;

  try {
    createdClient = await createImapClientForAccount({
      ...account,
      label: slot.label,
      credentialOwnerId: slot.ownerId,
      organizationId: resolvedOrganizationId,
    });

    await createdClient.client.connect();
    const lock = await createdClient.client.getMailboxLock("INBOX");
    lock.release();

    await updateCredentialVerificationStatus({
      scope: "imap",
      ownerId: slot.ownerId,
      organizationId: resolvedOrganizationId,
      status: "configured",
    });
    await sql`
      UPDATE mail_accounts
      SET status = 'configured', last_verified_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP
      WHERE id = ${account.id}
    `;

    return {
      label: slot.label,
      host: account.host,
      username: account.username,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : "IMAP-Verbindung fehlgeschlagen.";
    if (looksLikeImapCredentialError(message)) {
      await updateCredentialVerificationStatus({
        scope: "imap",
        ownerId: slot.ownerId,
        organizationId: resolvedOrganizationId,
        status: "invalid",
      });
      await sql`
        UPDATE mail_accounts
        SET status = 'invalid', updated_at = CURRENT_TIMESTAMP
        WHERE id = ${account.id}
      `;
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
