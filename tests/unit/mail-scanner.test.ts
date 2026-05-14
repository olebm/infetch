import { describe, expect, it } from "vitest";
import { sql } from "@/lib/db/client";
import { runPrimaryImapScan } from "@/mail/mail-scanner";

// NOTE: runPrimaryImapScan now uses the global postgres sql client.
// This test requires a real Postgres connection (DATABASE_URL env var).

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

describe("mail scanner", () => {
  it("scans two configured mailboxes and feeds both through the import pipeline", async () => {
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
