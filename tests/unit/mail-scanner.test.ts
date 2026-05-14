import Database from "better-sqlite3";
import { describe, expect, it } from "vitest";
import { runPrimaryImapScan } from "@/mail/mail-scanner";
import { schemaStatements } from "@/lib/db/schema";
import { seedDatabase } from "@/vendors/seed";

function createDb() {
  const db = new Database(":memory:");
  db.pragma("foreign_keys = ON");
  for (const statement of schemaStatements) {
    db.exec(statement);
  }
  seedDatabase(db);
  return db;
}

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
    const db = createDb();
    db.prepare(
      `INSERT INTO mail_accounts (id, label, host, port, secure, username, status)
       VALUES (1, 'Primary IMAP', 'imap.one.test', 993, 1, 'one@example.com', 'configured')`,
    ).run();
    db.prepare(
      `INSERT INTO mail_accounts (id, label, host, port, secure, username, status)
       VALUES (2, 'Secondary IMAP', 'imap.two.test', 993, 1, 'two@example.com', 'configured')`,
    ).run();

    const result = await runPrimaryImapScan({
      db,
      accountClients: [
        {
          account: { id: 1, label: "Primary IMAP", host: "imap.one.test", port: 993, secure: 1, username: "one@example.com" },
          client: createClient(
            [buildMail({ messageId: "one@example.com", subject: "OpenAI invoice", pdfName: "openai.pdf", pdfBody: "one" })],
            11n,
          ),
        },
        {
          account: { id: 2, label: "Secondary IMAP", host: "imap.two.test", port: 993, secure: 1, username: "two@example.com" },
          client: createClient(
            [buildMail({ messageId: "two@example.com", subject: "Hetzner invoice", pdfName: "hetzner.pdf", pdfBody: "two" })],
            22n,
          ),
        },
      ],
    });

    const invoices = (db.prepare(`SELECT COUNT(*) AS count FROM invoices`).get() as { count: number }).count;
    const mailMessages = (db.prepare(`SELECT COUNT(*) AS count FROM mail_messages`).get() as { count: number }).count;

    expect(result).toMatchObject({
      accountsScanned: 2,
      messagesSeen: 2,
      messagesProcessed: 2,
      pdfsFound: 2,
      imported: 2,
    });
    expect(invoices).toBe(2);
    expect(mailMessages).toBe(2);
  });
});
