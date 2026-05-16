import type { FetchMessageObject, ImapFlow } from "imapflow";
import { sql } from "@/lib/db/client";
import { appConfig } from "@/lib/config/env";
import { recordSyncEvent } from "@/lib/db/events";
import { importPdfBuffer } from "@/invoices/import-pipeline";
import { getOrgTier, getScanSinceDate } from "@/lib/tier";
import {
  createImapClientForAccount,
  listConfiguredImapAccounts,
  type ConfiguredImapAccount,
  type PrimaryImapAccount,
} from "@/mail/imap-client";
import { imapCredentialOwnerIdForLabel, type ImapCredentialOwnerId, type ImapMailAccountLabel } from "@/mail/imap-account-slots";
import { extractPdfAttachments, bodyStructureHasPdf } from "@/mail/attachment-extractor";
import { isSenderAutoIgnored, isSenderBlocked, recordSenderObservation } from "@/senders/discovered-senders";

type ImapClientLike = Pick<ImapFlow, "connect" | "getMailboxLock" | "fetch" | "logout"> & {
  mailbox: { uidValidity: bigint } | false;
};

export type ImapScanResult = {
  syncRunId: number;
  messagesSeen: number;
  messagesProcessed: number;
  pdfsFound: number;
  imported: number;
  duplicates: number;
  failed: number;
  accountsScanned: number;
  blockedSenders: number;
};

function asConfiguredAccount(account: PrimaryImapAccount): ConfiguredImapAccount {
  const label = (account.label || "Primary IMAP") as ImapMailAccountLabel;
  const credentialOwnerId = (imapCredentialOwnerIdForLabel(label) || "primary") as ImapCredentialOwnerId;
  return { ...account, label, credentialOwnerId };
}

export async function runPrimaryImapScan(input?: {
  client?: ImapClientLike;
  account?: PrimaryImapAccount;
  accountClients?: Array<{ account: PrimaryImapAccount; client: ImapClientLike }>;
  /** Festes Datum überschreibt die tier-basierte Berechnung (z. B. retroaktiver Scan). */
  sinceOverride?: Date;
  /** Quota-Prüfung überspringen (für retroaktiven 12-Monats-Scan). */
  bypassQuota?: boolean;
  /** Nur Accounts dieser Organisation scannen. */
  limitToOrgId?: string | null;
}): Promise<ImapScanResult> {
  const triggeredBy = input?.bypassQuota ? "retroactive_scan" : "user";
  const syncRunRows = await sql<{ id: number }[]>`
    INSERT INTO sync_runs (type, status, triggered_by, started_at)
    VALUES ('imap_scan', 'running', ${triggeredBy}, CURRENT_TIMESTAMP)
    RETURNING id
  `;
  const syncRunId = Number(syncRunRows[0].id);

  const summary: Omit<ImapScanResult, "syncRunId"> = {
    messagesSeen: 0,
    messagesProcessed: 0,
    pdfsFound: 0,
    imported: 0,
    duplicates: 0,
    failed: 0,
    accountsScanned: 0,
    blockedSenders: 0,
  };

  const accountScanErrors: string[] = [];
  let createdClient: ImapClientLike | null = null;
  const useInjectedClient = Boolean(input?.client && input?.account);
  const useInjectedAccountClients = Boolean(input?.accountClients?.length);

  try {
    let accounts: ConfiguredImapAccount[] = useInjectedAccountClients
      ? input!.accountClients!.map(({ account }) => asConfiguredAccount(account))
      : useInjectedClient
      ? [asConfiguredAccount(input!.account!)]
      : await listConfiguredImapAccounts();

    // Wenn auf eine Org begrenzt, nur deren Accounts scannen.
    if (input?.limitToOrgId) {
      accounts = accounts.filter((a) => a.organizationId === input.limitToOrgId);
    }

    if (!accounts.length) {
      throw new Error("Kein konfiguriertes IMAP-Postfach vorhanden.");
    }

    // Tier-Cache: pro Org einmal abfragen, nicht pro Nachricht.
    const tierCache = new Map<string | null, Awaited<ReturnType<typeof getOrgTier>>>();
    const getTierCached = async (orgId: string | null) => {
      if (!tierCache.has(orgId)) {
        tierCache.set(orgId, await getOrgTier(orgId));
      }
      return tierCache.get(orgId)!;
    };

    const scanOne = async (account: ConfiguredImapAccount) => {
      const client = useInjectedAccountClients
        ? (input!.accountClients!.find((entry) => entry.account.id === account.id)?.client as ImapClientLike)
        : useInjectedClient && input?.client
          ? input.client
          : (await createImapClientForAccount(account)).client;

      createdClient = client;
      await client.connect();
      const lock = await client.getMailboxLock("INBOX");
      try {
        const uidValidity = client.mailbox ? String(client.mailbox.uidValidity) : "unknown";
        // Tier-aware since-Datum: Free = Monatsbeginn, Pro = syncMonthsBack
        const tier = await getTierCached(account.organizationId ?? null);
        const since = input?.sinceOverride ?? getScanSinceDate(tier, appConfig.syncMonthsBack);
        const bypassQuota = input?.bypassQuota ?? false;

        // Phase 1: nur BODYSTRUCTURE laden (kein Volltext). Mails ohne
        // PDF-Anhang werden so nie heruntergeladen oder geparst.
        const pdfUids: number[] = [];
        for await (const meta of client.fetch({ since }, { uid: true, bodyStructure: true })) {
          summary.messagesSeen += 1;
          // Fehlt die BODYSTRUCTURE (Server-Limitierung), konservativ den
          // Volltext laden, damit keine Rechnung verloren geht.
          if (!meta.bodyStructure || bodyStructureHasPdf(meta.bodyStructure)) {
            pdfUids.push(meta.uid);
          }
        }

        // Phase 2: Volltext nur für Mails mit PDF-Anhang.
        if (pdfUids.length > 0) {
          for await (const message of client.fetch(
            pdfUids,
            { uid: true, envelope: true, source: true },
            { uid: true },
          )) {
            await processMessage(account.id, uidValidity, message, summary, bypassQuota);
          }
        }
      } finally {
        lock.release();
      }

      await client.logout();
      createdClient = null;
      summary.accountsScanned += 1;
    };

    for (const account of accounts) {
      try {
        await scanOne(account);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        accountScanErrors.push(`${account.label}: ${message}`);
        summary.failed += 1;
        try {
          await logoutImapClient(createdClient);
        } catch {
          // Connection may already be closed.
        }
        createdClient = null;
      }
    }

    if (summary.accountsScanned === 0 && accountScanErrors.length > 0) {
      throw new Error(accountScanErrors.join(" | "));
    }

    const finalPayload = {
      ...summary,
      accountErrors: accountScanErrors.length ? accountScanErrors : undefined,
    };

    await sql`
      UPDATE sync_runs
      SET status = 'succeeded', finished_at = CURRENT_TIMESTAMP, summary_json = ${JSON.stringify(finalPayload)}
      WHERE id = ${syncRunId}
    `;
    await recordSyncEvent({
      level: "info",
      eventType: "imap_scan_completed",
      message:
        accountScanErrors.length > 0
          ? `IMAP Scan abgeschlossen mit Hinweisen: ${accountScanErrors.join("; ")}`
          : "IMAP Scan abgeschlossen.",
      metadata: { ...finalPayload, syncRunId },
    });
    return { syncRunId, ...summary };
  } catch (error) {
    const message = error instanceof Error ? error.message : "IMAP scan failed";
    summary.failed += 1;
    await sql`
      UPDATE sync_runs
      SET status = 'failed', finished_at = CURRENT_TIMESTAMP, summary_json = ${JSON.stringify({ ...summary, error: message, accountErrors: accountScanErrors })}
      WHERE id = ${syncRunId}
    `;
    await recordSyncEvent({
      level: "error",
      eventType: "imap_scan_failed",
      message: "IMAP Scan fehlgeschlagen.",
      metadata: { syncRunId, error: message, accountErrors: accountScanErrors },
    });
    try {
      await logoutImapClient(createdClient);
    } catch {
      // Connection may already be closed.
    }
    throw error;
  }
}

async function processMessage(
  mailAccountId: number,
  uidValidity: string,
  message: FetchMessageObject,
  summary: Omit<ImapScanResult, "syncRunId">,
  bypassQuota = false,
) {
  if (!message.source) return;

  const parsed = await extractPdfAttachments(message.source);
  const mailMessageId = await upsertMailMessage({
    mailAccountId,
    uid: message.uid,
    uidValidity,
    messageId: parsed.messageId,
    fromAddress: parsed.fromAddress,
    subject: parsed.subject,
    date: parsed.date?.toISOString() || null,
  });

  const existing = await sql<{ processedAt: string | null }[]>`
    SELECT processed_at AS "processedAt" FROM mail_messages WHERE id = ${mailMessageId}
  `;
  if (existing[0]?.processedAt) return;

  summary.messagesProcessed += 1;
  summary.pdfsFound += parsed.pdfAttachments.length;

  const senderBlocked = parsed.fromAddress ? await isSenderBlocked(parsed.fromAddress) : false;
  // Sender-Memory: spart Mistral-Call wenn der Sender Junk-PDFs sendet.
  const senderAutoIgnored =
    !senderBlocked && parsed.fromAddress ? await isSenderAutoIgnored(parsed.fromAddress) : false;

  if (!parsed.pdfAttachments.length) {
    await markMailMessage(mailMessageId, "no_pdf");
    return;
  }

  if (senderBlocked || senderAutoIgnored) {
    summary.blockedSenders += 1;
    if (parsed.fromAddress) {
      await recordSenderObservation({
        fromAddress: parsed.fromAddress,
        displayName: parsed.fromName,
        hadPdfAttachments: true,
        pdfsImported: 0,
        blockedSkip: true,
      });
    }
    await markMailMessage(mailMessageId, senderAutoIgnored ? "auto_ignored_sender" : "blocked_sender");
    return;
  }

  // Org-ID für Quota-Check aus mail_accounts laden (einmalig pro Nachricht)
  const orgRows = await sql<{ organizationId: string | null }[]>`
    SELECT organization_id AS "organizationId" FROM mail_accounts WHERE id = ${mailAccountId} LIMIT 1
  `;
  const organizationId = orgRows[0]?.organizationId ?? null;

  let importedForMessage = 0;
  for (const attachment of parsed.pdfAttachments) {
    const result = await importPdfBuffer({
      buffer: attachment.content,
      originalFilename: attachment.filename,
      mimeType: attachment.contentType,
      sourceType: "mail",
      sourceRefId: String(mailMessageId),
      organizationId,
      bypassQuota,
    });
    if (result.ok && result.status === "imported") {
      summary.imported += 1;
      importedForMessage += 1;
    } else if (result.ok && result.status === "duplicate") {
      summary.duplicates += 1;
    } else {
      summary.failed += 1;
    }
  }

  if (parsed.fromAddress) {
    await recordSenderObservation({
      fromAddress: parsed.fromAddress,
      displayName: parsed.fromName,
      hadPdfAttachments: true,
      pdfsImported: importedForMessage,
    });
  }

  await markMailMessage(mailMessageId, importedForMessage > 0 ? "processed" : "no_new_invoice");
}

async function upsertMailMessage(input: {
  mailAccountId: number;
  uid: number;
  uidValidity: string;
  messageId: string | null;
  fromAddress: string | null;
  subject: string | null;
  date: string | null;
}): Promise<number> {
  await sql`
    INSERT INTO mail_messages (
      mail_account_id, mailbox, uid, uidvalidity, message_id, from_address, subject, date, seen_at, status
    )
    VALUES (${input.mailAccountId}, 'INBOX', ${input.uid}, ${input.uidValidity}, ${input.messageId}, ${input.fromAddress}, ${input.subject}, ${input.date}, CURRENT_TIMESTAMP, 'pending')
    ON CONFLICT(mail_account_id, mailbox, uidvalidity, uid) DO UPDATE SET
      message_id = COALESCE(mail_messages.message_id, excluded.message_id),
      from_address = COALESCE(mail_messages.from_address, excluded.from_address),
      subject = COALESCE(mail_messages.subject, excluded.subject),
      date = COALESCE(mail_messages.date, excluded.date),
      seen_at = CURRENT_TIMESTAMP
  `;

  const rows = await sql<{ id: number }[]>`
    SELECT id
    FROM mail_messages
    WHERE mail_account_id = ${input.mailAccountId} AND mailbox = 'INBOX' AND uidvalidity = ${input.uidValidity} AND uid = ${input.uid}
  `;
  return rows[0].id;
}

async function markMailMessage(id: number, status: string): Promise<void> {
  await sql`
    UPDATE mail_messages
    SET status = ${status}, processed_at = CURRENT_TIMESTAMP
    WHERE id = ${id}
  `;
}

async function logoutImapClient(client: ImapClientLike | null) {
  if (!client) return;
  await client.logout();
}
