import type { FetchMessageObject, ImapFlow } from "imapflow";
import { unsafeGlobalSql as sql } from "@/lib/db/unsafe-global";
import { appConfig } from "@/lib/config/env";
import { recordSyncEvent } from "@/lib/db/events";
import { withAdvisoryLock } from "@/lib/db/advisory-lock";
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
import { autoAssignSenders, isSenderAutoIgnored, isSenderBlocked, recordSenderObservation } from "@/senders/discovered-senders";
import { rematchUnmatchedInvoices } from "@/vendors/auto-alias";
import { matchVendor } from "@/vendors/matcher";

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

type RunPrimaryImapScanInput = {
  client?: ImapClientLike;
  account?: PrimaryImapAccount;
  accountClients?: Array<{ account: PrimaryImapAccount; client: ImapClientLike }>;
  /** Festes Datum überschreibt die tier-basierte Berechnung (z. B. retroaktiver Scan). */
  sinceOverride?: Date;
  /** Quota-Prüfung überspringen (für retroaktiven 12-Monats-Scan). */
  bypassQuota?: boolean;
  /** Nur Accounts dieser Organisation scannen. */
  limitToOrgId?: string | null;
  /** Auslöser-Label für sync_runs.triggered_by (CHECK erlaubt 'user' |
   *  'schedule' | 'system'). Default: "user" (manueller Scan). Der Auto-Pilot-
   *  Scheduler übergibt "schedule" → wird als „automatisch" angezeigt. */
  triggeredBy?: string;
};

export async function runPrimaryImapScan(
  input?: RunPrimaryImapScanInput,
): Promise<ImapScanResult> {
  // Cross-Prozess-Single-Runner, jetzt PER ORG: verschiedene Orgs scannen
  // parallel (eigener Lock-Key), ein zweiter Trigger DERSELBEN Org skippt.
  // So blockiert ein langsamer Scan einer Org nicht das Onboarding einer
  // anderen. Ohne Org (Tests / injizierte Clients) globaler Key.
  const lockKey = input?.limitToOrgId ? `imap_scan:${input.limitToOrgId}` : "imap_scan";
  return withAdvisoryLock(
    lockKey,
    () => runPrimaryImapScanImpl(input),
    () => ({
      syncRunId: 0,
      messagesSeen: 0,
      messagesProcessed: 0,
      pdfsFound: 0,
      imported: 0,
      duplicates: 0,
      failed: 0,
      accountsScanned: 0,
      blockedSenders: 0,
    }),
  );
}

async function runPrimaryImapScanImpl(
  input?: RunPrimaryImapScanInput,
): Promise<ImapScanResult> {
  // sync_runs.triggered_by CHECK erlaubt nur 'user' | 'schedule' | 'system'.
  // Default 'user' (manueller/onboarding Scan); der Auto-Pilot übergibt explizit
  // 'schedule'. Der retroaktive Backscan (bypassQuota) lief vorher als
  // 'retroactive_scan' — das verletzt die CHECK (INFETCH-222) → jetzt 'user'.
  const triggeredBy = input?.triggeredBy ?? "user";
  const syncRunRows = await sql<{ id: number }[]>`
    INSERT INTO sync_runs (type, status, triggered_by, started_at, organization_id)
    VALUES ('imap_scan', 'running', ${triggeredBy}, CURRENT_TIMESTAMP, ${input?.limitToOrgId ?? null})
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
      : await listConfiguredImapAccounts(input?.limitToOrgId);

    // Safety-net: secondary JS filter in case any row slipped through
    // (e.g. the DB-level filter was skipped due to null limitToOrgId).
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

        // Phase 2: Volltext nur für Mails mit PDF-Anhang — NEUESTE ZUERST.
        // imapflow liefert pro fetch aufsteigend (älteste zuerst), unabhängig von
        // der UID-Array-Reihenfolge. Daher in absteigenden UID-Batches holen und
        // stoppen, sobald das Monatslimit greift — so landen beim Erstscan die
        // JÜNGSTEN Rechnungen im 30er-Kontingent statt der ältesten. Nicht geholte
        // (ältere) Mails bleiben unmarkiert → später nachholbar (Dedupe idempotent).
        if (pdfUids.length > 0) {
          const descendingUids = [...pdfUids].sort((a, b) => b - a);
          const FETCH_BATCH = 10;
          const quotaSignal = { hit: false };
          for (let i = 0; i < descendingUids.length && !quotaSignal.hit; i += FETCH_BATCH) {
            const batch = descendingUids.slice(i, i + FETCH_BATCH);
            for await (const message of client.fetch(
              batch,
              { uid: true, envelope: true, source: true },
              { uid: true },
            )) {
              await processMessage(account.id, account.organizationId ?? null, uidValidity, message, summary, bypassQuota, quotaSignal);
              if (quotaSignal.hit) break;
            }
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

    // Self-Healing-Erkennung: den (bisher nur manuellen) Sender-Lever automatisch
    // nach dem Scan ziehen, wenn neue Rechnungen kamen. So bekommt ein bislang
    // unbekannter Anbieter (z. B. awork) sofort einen Vendor und unzugeordnete
    // Rechnungen werden neu gematcht — ohne dass jemand im Senders-Tab klickt.
    // Org-scoped + best-effort: ein Fehler hier darf den bereits als erfolgreich
    // verbuchten Scan nicht kippen.
    if (summary.imported > 0) {
      const scannedOrgIds = input?.limitToOrgId
        ? [input.limitToOrgId]
        : [...new Set(accounts.map((account) => account.organizationId ?? null))];
      for (const orgId of scannedOrgIds) {
        try {
          await autoAssignSenders(orgId);
          await rematchUnmatchedInvoices(matchVendor, orgId);
        } catch (leverError) {
          await recordSyncEvent({
            level: "warning",
            eventType: "post_scan_recognition_failed",
            message: "Automatische Anbieter-Zuordnung nach dem Scan fehlgeschlagen.",
            metadata: {
              syncRunId,
              organizationId: orgId,
              error: leverError instanceof Error ? leverError.message : String(leverError),
            },
          });
        }
      }
    }

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
  organizationId: string | null,
  uidValidity: string,
  message: FetchMessageObject,
  summary: Omit<ImapScanResult, "syncRunId">,
  bypassQuota = false,
  quotaSignal?: { hit: boolean },
) {
  if (!message.source) return;

  const parsed = await extractPdfAttachments(message.source);
  // Datensparsamkeit: bei der Erstanlage NUR technische Koordinaten ablegen.
  // Absender/Betreff/Message-ID/Datum werden erst gespeichert, wenn aus der
  // Mail eine Rechnung erkannt wurde (attachInvoiceMailMetadata weiter unten).
  const mailMessageId = await upsertMailMessage({
    mailAccountId,
    uid: message.uid,
    uidValidity,
  });

  const existing = await sql<{ processedAt: string | null }[]>`
    SELECT processed_at AS "processedAt" FROM mail_messages WHERE id = ${mailMessageId}
  `;
  if (existing[0]?.processedAt) return;

  summary.messagesProcessed += 1;
  summary.pdfsFound += parsed.pdfAttachments.length;

  const senderBlocked = parsed.fromAddress
    ? await isSenderBlocked(parsed.fromAddress, organizationId)
    : false;
  // Sender-Memory: spart Mistral-Call wenn der Sender Junk-PDFs sendet.
  const senderAutoIgnored =
    !senderBlocked && parsed.fromAddress
      ? await isSenderAutoIgnored(parsed.fromAddress, organizationId)
      : false;

  if (!parsed.pdfAttachments.length) {
    await markMailMessage(mailMessageId, "no_pdf");
    return;
  }

  if (senderBlocked || senderAutoIgnored) {
    summary.blockedSenders += 1;
    if (parsed.fromAddress) {
      await recordSenderObservation({
        organizationId,
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

  // organizationId wird vom Account in scanOne() durchgereicht.
  let importedForMessage = 0;
  let quotaBlocked = false;
  // True, sobald die Mail eine erkannte Rechnung enthielt (neu importiert ODER
  // bereits bekanntes Duplikat). Nur dann dürfen/müssen Absender, Betreff &
  // Co. gespeichert werden — die Vendor-Alias-Erkennung joint darüber.
  let recognizedInvoiceInMessage = false;
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
      recognizedInvoiceInMessage = true;
    } else if (result.ok && result.status === "duplicate") {
      summary.duplicates += 1;
      recognizedInvoiceInMessage = true;
    } else {
      summary.failed += 1;
      if (!result.ok && result.status === "quota_exceeded") {
        quotaBlocked = true;
        if (quotaSignal) quotaSignal.hit = true;
      }
    }
  }

  if (parsed.fromAddress) {
    await recordSenderObservation({
      organizationId,
      fromAddress: parsed.fromAddress,
      displayName: parsed.fromName,
      hadPdfAttachments: true,
      pdfsImported: importedForMessage,
    });
  }

  // Bei Quota-Block die Nachricht NICHT als verarbeitet markieren (processed_at
  // bliebe sonst gesetzt → nie erneuter Versuch). So wird sie im nächsten Scan
  // bzw. Folgemonat (wieder freies Kontingent) erneut importiert. Bereits
  // importierte Anhänge sind via SHA256-Dedupe idempotent.
  if (quotaBlocked && importedForMessage === 0) {
    return;
  }

  // Metadaten NUR für Mails mit erkannter Rechnung nachtragen. Nicht-Rechnungen,
  // blockierte & Junk-Mails behalten ausschließlich ihren technischen
  // UID-Marker — kein Absender, kein Betreff, kein Postfach-Inhalt.
  if (recognizedInvoiceInMessage) {
    await attachInvoiceMailMetadata(mailMessageId, {
      messageId: parsed.messageId,
      fromAddress: parsed.fromAddress,
      subject: parsed.subject,
      date: parsed.date?.toISOString() || null,
    });
  }

  await markMailMessage(mailMessageId, importedForMessage > 0 ? "processed" : "no_new_invoice");
}

/**
 * Legt die Dedupe-Zeile für eine gescannte Mail an — bewusst NUR mit
 * technischen Koordinaten (Account, Mailbox, IMAP-UID). Absender, Betreff,
 * Message-ID und Datum werden hier absichtlich NICHT gespeichert; das
 * übernimmt attachInvoiceMailMetadata() ausschließlich für Mails, aus denen
 * eine Rechnung erkannt wurde. So bleibt von Nicht-Rechnungen, blockierten
 * und Junk-Mails kein Postfach-Inhalt zurück, nur ein opaker UID-Marker zur
 * Idempotenz.
 */
async function upsertMailMessage(input: {
  mailAccountId: number;
  uid: number;
  uidValidity: string;
}): Promise<number> {
  await sql`
    INSERT INTO mail_messages (
      mail_account_id, mailbox, uid, uidvalidity, seen_at, status
    )
    VALUES (${input.mailAccountId}, 'INBOX', ${input.uid}, ${input.uidValidity}, CURRENT_TIMESTAMP, 'pending')
    ON CONFLICT(mail_account_id, mailbox, uidvalidity, uid) DO UPDATE SET
      seen_at = CURRENT_TIMESTAMP
  `;

  const rows = await sql<{ id: number }[]>`
    SELECT id
    FROM mail_messages
    WHERE mail_account_id = ${input.mailAccountId} AND mailbox = 'INBOX' AND uidvalidity = ${input.uidValidity} AND uid = ${input.uid}
  `;
  return rows[0].id;
}

/**
 * Trägt Absender/Betreff/Message-ID/Datum nach — NUR für Mails mit erkannter
 * Rechnung. Diese Metadaten werden von der Vendor-Alias-Erkennung
 * (auto-alias/suggestions) über invoice_files → mail_messages benötigt.
 * COALESCE schützt bereits gesetzte Werte (idempotent bei Re-Scan).
 */
async function attachInvoiceMailMetadata(id: number, input: {
  messageId: string | null;
  fromAddress: string | null;
  subject: string | null;
  date: string | null;
}): Promise<void> {
  await sql`
    UPDATE mail_messages
    SET message_id   = COALESCE(message_id, ${input.messageId}),
        from_address = COALESCE(from_address, ${input.fromAddress}),
        subject      = COALESCE(subject, ${input.subject}),
        date         = COALESCE(date, ${input.date})
    WHERE id = ${id}
  `;
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
