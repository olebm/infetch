import { describe, expect, it } from "vitest";
import { sql } from "@/lib/db/client";
import { runPrimaryImapScan } from "@/mail/mail-scanner";

// NOTE: runPrimaryImapScan now uses the global postgres sql client.
// This test requires a real Postgres connection (DATABASE_URL env var).
// It also calls the PDF import pipeline which uploads to Supabase Storage —
// SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY must be set. The test is skipped
// in CI environments that only have a plain Postgres instance.
const hasSupabase = Boolean(process.env.SUPABASE_URL);

function buildMail(options: { messageId: string; subject: string; pdfName: string; pdfBody: string }) {
  return Buffer.from(
    [
      "From: Billing <billing@example.com>",
      "To: invoices@example.com",
      `Subject: ${options.subject}`,
      `Message-ID: <${options.messageId}>`,
      "Date: Fri, 01 May 2026 10:00:00 +0000",
      "MIME-Version: 1.0",
      'Content-Type: multipart/mixed; boundary="b1"',
      "",
      "--b1",
      "Content-Type: text/plain; charset=utf-8",
      "",
      "Invoice attached.",
      "--b1",
      `Content-Type: application/pdf; name="${options.pdfName}"`,
      "Content-Transfer-Encoding: base64",
      `Content-Disposition: attachment; filename="${options.pdfName}"`,
      "",
      Buffer.from(`%PDF-1.7\n${options.pdfBody}`).toString("base64"),
      "--b1--",
    ].join("\r\n"),
  );
}

function createClient(messages: Buffer[], uidValidity: bigint) {
  return {
    mailbox: { uidValidity },
    async connect() {},
    async logout() {},
    async getMailboxLock() {
      return { path: "INBOX", release() {} };
    },
    async *fetch() {
      let uid = 1;
      for (const source of messages) {
        const id = uid++;
        yield { uid: id, seq: id, source };
      }
    },
  };
}

function buildPlainMail(messageId: string, subject: string) {
  return Buffer.from(
    [
      "From: Newsletter <news@example.com>",
      "To: invoices@example.com",
      `Subject: ${subject}`,
      `Message-ID: <${messageId}>`,
      "Date: Fri, 01 May 2026 10:00:00 +0000",
      "MIME-Version: 1.0",
      "Content-Type: text/plain; charset=utf-8",
      "",
      "Just a private newsletter, no attachment.",
    ].join("\r\n"),
  );
}

/**
 * Zwei-Phasen-Fake: Phase 1 liefert nur bodyStructure, Phase 2 liefert
 * Volltext ausschließlich für die angefragten UIDs. `sourceFetchedUids`
 * protokolliert, für welche Mails der Volltext tatsächlich geladen wurde.
 */
function createTwoPhaseClient(
  messages: Array<{ source: Buffer; hasPdf: boolean }>,
  uidValidity: bigint,
) {
  const sourceFetchedUids: number[] = [];
  return {
    sourceFetchedUids,
    mailbox: { uidValidity },
    async connect() {},
    async logout() {},
    async getMailboxLock() {
      return { path: "INBOX", release() {} };
    },
    async *fetch(range: unknown, query: { bodyStructure?: boolean; source?: boolean }) {
      if (query.bodyStructure) {
        let uid = 1;
        for (const m of messages) {
          const id = uid++;
          yield {
            uid: id,
            seq: id,
            bodyStructure: m.hasPdf ? { type: "application/pdf" } : { type: "text/plain" },
          };
        }
        return;
      }
      if (query.source) {
        const requested = range as number[];
        let uid = 1;
        for (const m of messages) {
          const id = uid++;
          if (requested.includes(id)) {
            sourceFetchedUids.push(id);
            yield { uid: id, seq: id, source: m.source };
          }
        }
      }
    },
  };
}

describe("mail scanner", () => {
  it.skipIf(!hasSupabase)("never downloads the full source of mails without a PDF attachment", async () => {
    const acctRows = await sql<{ id: number }[]>`
      INSERT INTO mail_accounts (label, host, port, secure, username, status)
      VALUES ('Primary IMAP MinTest', 'imap.min.test', 993, true, 'min-test@example.com', 'configured')
      RETURNING id
    `;
    const acctId = acctRows[0].id;

    const client = createTwoPhaseClient(
      [
        { source: buildMail({ messageId: "min-pdf@example.com", subject: "Stripe invoice", pdfName: "stripe.pdf", pdfBody: "x" }), hasPdf: true },
        { source: buildPlainMail("min-plain@example.com", "Private newsletter"), hasPdf: false },
      ],
      99n,
    );

    const result = await runPrimaryImapScan({
      accountClients: [
        {
          account: { id: acctId, label: "Primary IMAP" as const, host: "imap.min.test", port: 993, secure: 1, username: "min-test@example.com" },
          client,
        },
      ],
    });

    // Beide Mails werden "gesehen" (Phase 1), aber nur die PDF-Mail (uid 1)
    // wird im Volltext geladen — die private Mail (uid 2) nie.
    expect(result.messagesSeen).toBe(2);
    expect(client.sourceFetchedUids).toEqual([1]);
    expect(result.messagesProcessed).toBe(1);
  });

  it.skipIf(!hasSupabase)("scans two configured mailboxes and feeds both through the import pipeline", async () => {
    // Insert test mail accounts
    const acct1Rows = await sql<{ id: number }[]>`
      INSERT INTO mail_accounts (label, host, port, secure, username, status)
      VALUES ('Primary IMAP Test', 'imap.one.test', 993, true, 'scanner-test-one@example.com', 'configured')
      RETURNING id
    `;
    const acct2Rows = await sql<{ id: number }[]>`
      INSERT INTO mail_accounts (label, host, port, secure, username, status)
      VALUES ('Secondary IMAP Test', 'imap.two.test', 993, true, 'scanner-test-two@example.com', 'configured')
      RETURNING id
    `;
    const acct1Id = acct1Rows[0].id;
    const acct2Id = acct2Rows[0].id;

    const result = await runPrimaryImapScan({
      accountClients: [
        {
          account: { id: acct1Id, label: "Primary IMAP" as const, host: "imap.one.test", port: 993, secure: 1, username: "scanner-test-one@example.com" },
          client: createClient(
            [buildMail({ messageId: "scanner-test-one@example.com", subject: "OpenAI invoice", pdfName: "openai.pdf", pdfBody: "one" })],
            11n,
          ),
        },
        {
          account: { id: acct2Id, label: "Secondary IMAP" as const, host: "imap.two.test", port: 993, secure: 1, username: "scanner-test-two@example.com" },
          client: createClient(
            [buildMail({ messageId: "scanner-test-two@example.com", subject: "Hetzner invoice", pdfName: "hetzner.pdf", pdfBody: "two" })],
            22n,
          ),
        },
      ],
    });

    const invoiceRows = await sql<{ count: string }[]>`
      SELECT COUNT(*) AS count FROM invoices
    `;
    const mailRows = await sql<{ count: string }[]>`
      SELECT COUNT(*) AS count FROM mail_messages WHERE mail_account_id IN (${acct1Id}, ${acct2Id})
    `;

    expect(result).toMatchObject({
      accountsScanned: 2,
      messagesSeen: 2,
      messagesProcessed: 2,
      pdfsFound: 2,
    });
    expect(Number(mailRows[0].count)).toBe(2);
    // Note: invoices may be > 2 if other tests ran; just check we got at least 2
    expect(Number(invoiceRows[0].count)).toBeGreaterThanOrEqual(2);
  });
});
