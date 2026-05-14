import { subMonths } from "date-fns";
import type { FetchMessageObject, ImapFlow } from "imapflow";
import { sql } from "@/lib/db/client";
import { appConfig } from "@/lib/config/env";
import { recordSyncEvent } from "@/lib/db/events";
import { importPdfBuffer } from "@/invoices/import-pipeline";
import {
  createImapClientForAccount,
  listConfiguredImapAccounts,
  type ConfiguredImapAccount,
  type PrimaryImapAccount,
} from "@/mail/imap-client";
import { imapCredentialOwnerIdForLabel, type ImapCredentialOwnerId, type ImapMailAccountLabel } from "@/mail/imap-account-slots";
import { extractPdfAttachments } from "@/mail/attachment-extractor";
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
}): Promise<ImapScanResult> {
  const syncRunRows = await sql<{ id: number }[]>`
    INSERT INTO sync_runs (type, status, triggered_by, started_at)
    VALUES ('imap_scan', 'running', 'user', CURRENT_TIMESTAMP)
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
    const accounts: ConfiguredImapAccount[] = useInjectedAccountClients
      ? input!.accountClients!.map(({ account }) => asConfiguredAccount(account))
      : useInjectedClient
      ? [asConfiguredAccount(input!.account!)]
      : await listConfiguredImapAccounts();

    if (!accounts.length) {
      throw new Error("Kein konfiguriertes IMAP-Postfach vorhanden.");
    }

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
        const since = subMonths(new Date(), appConfig.syncMonthsBack);
        for await (const message of client.fetch({ since }, { uid: true, envelope: true, source: true })) {
          summary.messagesSeen += 1;
          await processMessage(account.id, uidValidity, message, summary);
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

  let importedForMessage = 0;
  for (const attachment of parsed.pdfAttachments) {
    const result = await importPdfBuffer({
      buffer: attachment.content,
      originalFilename: attachment.filename,
      mimeType: attachment.contentType,
      sourceType: "mail",
      sourceRefId: String(mailMessageId),
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
