import crypto from "node:crypto";
import { unsafeGlobalSql as sql } from "@/lib/db/unsafe-global";
import {
  BUCKETS,
  downloadFromStorage,
  uploadToStorage,
  buildInvoiceStorageKey,
} from "@/lib/supabase/storage";
import {
  listConfiguredImapAccounts,
  createImapClientForAccount,
  type ConfiguredImapAccount,
} from "@/mail/imap-client";
import { extractPdfAttachments, type ParsedMailPdfAttachment } from "@/mail/attachment-extractor";

/**
 * Stellt Rechnungs-PDFs wieder her, die durch die Storage-Key-Kollision
 * (INFETCH-243) überschrieben wurden. Pro betroffener Datei wird das
 * Original-Attachment per IMAP neu geholt (über die gespeicherte
 * mail_messages-Referenz), per sha256 dem richtigen Beleg zugeordnet und unter
 * einem NEUEN eindeutigen Storage-Key abgelegt; `stored_path` wird aktualisiert.
 *
 * SICHERHEIT: `dryRun` DEFAULT true. Dry-Run macht nur Reads (Storage-Download
 * zum Überlebenden-Check + IMAP-Fetch zum Recoverability-Check) — KEIN Upload,
 * KEIN DB-Write. Nur `dryRun:false` schreibt.
 */

export type RecoverOutcome =
  | "would_recover" // dry-run: passendes Attachment gefunden, wiederherstellbar
  | "recovered" // execute: neu abgelegt + stored_path aktualisiert
  | "not_overwritten" // Storage-Inhalt passt zum sha256 → Überlebender, nichts zu tun
  | "no_mail_ref" // nicht aus Mail (oder keine Mail-Referenz) → nicht auto-heilbar
  | "account_not_configured" // mail_account nicht (mehr) konfiguriert
  | "mail_not_found" // Mail/uid im Postfach nicht (mehr) auffindbar
  | "no_matching_attachment" // Mail da, aber kein Attachment mit passendem sha256
  | "error";

export type RecoverDetail = {
  invoiceId: number;
  fileId: number;
  outcome: RecoverOutcome;
  note?: string;
};

export type RecoverResult = {
  dryRun: boolean;
  scanned: number;
  notOverwritten: number;
  recoverable: number;
  recovered: number;
  unrecoverable: number;
  details: RecoverDetail[];
};

export type MailCoord = {
  mailAccountId: number;
  mailbox: string;
  uidValidity: string;
  uid: number;
};

export type RecoverDeps = {
  /** Lädt das aktuell gespeicherte Objekt (default: INVOICES-Bucket). */
  downloadObject?: (storedPath: string) => Promise<Buffer>;
  /** Holt die PDF-Attachments je uid (default: IMAP-Connect + fetch + extract). */
  fetchAttachmentsByUid?: (
    account: ConfiguredImapAccount,
    coords: MailCoord[],
  ) => Promise<Map<number, ParsedMailPdfAttachment[]>>;
  /** Legt das wiederhergestellte PDF ab (default: uploadToStorage INVOICES). */
  storePdf?: (key: string, content: Buffer) => Promise<void>;
};

type AffectedRow = {
  fileId: number;
  invoiceId: number;
  storedPath: string;
  sha256: string | null;
  sourceType: string;
  sourceRefId: string | null;
  organizationId: string | null;
  vendorKey: string | null;
  invoiceDate: string | null;
};

export function sha256Hex(buf: Buffer): string {
  return crypto.createHash("sha256").update(buf).digest("hex");
}

/** Wählt das Attachment, dessen Inhalt zum erwarteten sha256 passt (oder null). */
export function pickAttachmentForSha(
  attachments: ParsedMailPdfAttachment[],
  expectedSha256: string,
): ParsedMailPdfAttachment | null {
  for (const attachment of attachments) {
    if (sha256Hex(attachment.content) === expectedSha256) return attachment;
  }
  return null;
}

const defaultDownloadObject = (storedPath: string) =>
  downloadFromStorage(BUCKETS.INVOICES, storedPath);

const defaultStorePdf = (key: string, content: Buffer) =>
  uploadToStorage(BUCKETS.INVOICES, key, content, { contentType: "application/pdf" });

async function defaultFetchAttachmentsByUid(
  account: ConfiguredImapAccount,
  coords: MailCoord[],
): Promise<Map<number, ParsedMailPdfAttachment[]>> {
  const result = new Map<number, ParsedMailPdfAttachment[]>();
  const { client } = await createImapClientForAccount(account);
  await client.connect();
  try {
    const byMailbox = new Map<string, MailCoord[]>();
    for (const coord of coords) {
      const list = byMailbox.get(coord.mailbox) ?? [];
      list.push(coord);
      byMailbox.set(coord.mailbox, list);
    }
    for (const [mailbox, mailboxCoords] of byMailbox) {
      const lock = await client.getMailboxLock(mailbox);
      try {
        const current =
          client.mailbox && typeof client.mailbox !== "boolean"
            ? String(client.mailbox.uidValidity)
            : "";
        // uidvalidity-Mismatch → die gespeicherten uids zeigen auf andere Mails.
        // Solche uids NICHT abrufen (Caller markiert sie als mail_not_found).
        const uids = mailboxCoords.filter((c) => c.uidValidity === current).map((c) => c.uid);
        if (uids.length === 0) continue;
        for await (const message of client.fetch(
          uids,
          { uid: true, source: true },
          { uid: true },
        )) {
          if (!message.source) continue;
          const parsed = await extractPdfAttachments(message.source as Buffer);
          result.set(message.uid, parsed.pdfAttachments);
        }
      } finally {
        lock.release();
      }
    }
  } finally {
    try {
      await client.logout();
    } catch {
      // Teardown-Fehler dürfen das Ergebnis nicht verfälschen.
    }
  }
  return result;
}

export async function recoverOverwrittenPdfs(
  opts: {
    dryRun?: boolean;
    organizationId?: string | null;
    limit?: number;
    deps?: RecoverDeps;
  } = {},
): Promise<RecoverResult> {
  const dryRun = opts.dryRun ?? true;
  const orgId = opts.organizationId ?? null;
  const downloadObject = opts.deps?.downloadObject ?? defaultDownloadObject;
  const fetchAttachmentsByUid = opts.deps?.fetchAttachmentsByUid ?? defaultFetchAttachmentsByUid;
  const storePdf = opts.deps?.storePdf ?? defaultStorePdf;

  // Kollidierende Dateien: stored_path von >1 Datei geteilt (org-scoped).
  const rows = await sql<AffectedRow[]>`
    WITH shared AS (
      SELECT f.stored_path
      FROM invoice_files f
      JOIN invoices i ON i.id = f.invoice_id
      WHERE (${orgId}::text IS NULL OR i.organization_id = ${orgId})
      GROUP BY f.stored_path
      HAVING count(*) > 1
    )
    SELECT f.id AS "fileId", f.invoice_id AS "invoiceId", f.stored_path AS "storedPath",
      f.sha256, f.source_type AS "sourceType", f.source_ref_id AS "sourceRefId",
      i.organization_id AS "organizationId", v.canonical_key AS "vendorKey",
      i.invoice_date AS "invoiceDate"
    FROM invoice_files f
    JOIN invoices i ON i.id = f.invoice_id
    LEFT JOIN vendors v ON v.id = i.vendor_id
    WHERE f.stored_path IN (SELECT stored_path FROM shared)
    ORDER BY f.stored_path, f.id
    ${opts.limit != null ? sql`LIMIT ${opts.limit}` : sql``}
  `;

  const result: RecoverResult = {
    dryRun,
    scanned: rows.length,
    notOverwritten: 0,
    recoverable: 0,
    recovered: 0,
    unrecoverable: 0,
    details: [],
  };

  // Überlebenden-Check: Storage-Objekt einmal pro Pfad laden + hashen.
  const objectShaCache = new Map<string, string | null>();
  const storedSha = async (path: string): Promise<string | null> => {
    const cached = objectShaCache.get(path);
    if (cached !== undefined) return cached;
    let sha: string | null = null;
    try {
      sha = sha256Hex(await downloadObject(path));
    } catch {
      sha = null;
    }
    objectShaCache.set(path, sha);
    return sha;
  };

  const fail = (row: AffectedRow, outcome: RecoverOutcome, note?: string) => {
    result.unrecoverable++;
    result.details.push({ invoiceId: row.invoiceId, fileId: row.fileId, outcome, note });
  };

  const needRecovery: AffectedRow[] = [];
  for (const row of rows) {
    if (!row.sha256) {
      fail(row, "error", "kein sha256 gespeichert");
      continue;
    }
    if ((await storedSha(row.storedPath)) === row.sha256) {
      result.notOverwritten++;
      result.details.push({
        invoiceId: row.invoiceId,
        fileId: row.fileId,
        outcome: "not_overwritten",
      });
      continue;
    }
    if (row.sourceType !== "mail" || !row.sourceRefId || !/^[0-9]+$/.test(row.sourceRefId)) {
      fail(row, "no_mail_ref", `source=${row.sourceType}`);
      continue;
    }
    needRecovery.push(row);
  }

  if (needRecovery.length === 0) return result;

  // Mail-Koordinaten laden.
  const refIds = needRecovery.map((r) => Number(r.sourceRefId));
  const coordRows = await sql<(MailCoord & { id: number })[]>`
    SELECT id, mail_account_id AS "mailAccountId", mailbox, uidvalidity AS "uidValidity", uid
    FROM mail_messages WHERE id = ANY(${refIds}::bigint[])
  `;
  const coordByMsg = new Map(coordRows.map((c) => [c.id, c]));

  // Konfigurierte IMAP-Accounts (org-scoped) für die Verbindung.
  const accountById = new Map((await listConfiguredImapAccounts(orgId)).map((a) => [a.id, a]));

  // Pro Account gruppieren.
  const byAccount = new Map<number, Array<AffectedRow & { coord: MailCoord }>>();
  for (const row of needRecovery) {
    const coord = coordByMsg.get(Number(row.sourceRefId));
    if (!coord) {
      fail(row, "mail_not_found", "mail_messages-Zeile fehlt");
      continue;
    }
    const list = byAccount.get(coord.mailAccountId) ?? [];
    list.push({ ...row, coord });
    byAccount.set(coord.mailAccountId, list);
  }

  for (const [accountId, needs] of byAccount) {
    const account = accountById.get(accountId);
    if (!account) {
      for (const n of needs) fail(n, "account_not_configured", `mail_account ${accountId}`);
      continue;
    }
    let attByUid: Map<number, ParsedMailPdfAttachment[]>;
    try {
      attByUid = await fetchAttachmentsByUid(
        account,
        needs.map((n) => n.coord),
      );
    } catch (err) {
      for (const n of needs) fail(n, "error", err instanceof Error ? err.message : String(err));
      continue;
    }
    for (const n of needs) {
      const attachments = attByUid.get(n.coord.uid) ?? [];
      const match = pickAttachmentForSha(attachments, n.sha256!);
      if (!match) {
        fail(n, attachments.length ? "no_matching_attachment" : "mail_not_found");
        continue;
      }
      if (dryRun) {
        result.recoverable++;
        result.details.push({ invoiceId: n.invoiceId, fileId: n.fileId, outcome: "would_recover" });
        continue;
      }
      try {
        const newKey = buildInvoiceStorageKey({
          orgId: n.organizationId,
          vendorKey: n.vendorKey,
          productLabel: null,
          invoiceDate: n.invoiceDate,
          sha256: n.sha256!,
        });
        await storePdf(newKey, match.content);
        await sql`UPDATE invoice_files SET stored_path = ${newKey} WHERE id = ${n.fileId}`;
        result.recovered++;
        result.details.push({
          invoiceId: n.invoiceId,
          fileId: n.fileId,
          outcome: "recovered",
          note: newKey,
        });
      } catch (err) {
        fail(n, "error", err instanceof Error ? err.message : String(err));
      }
    }
  }

  return result;
}
