import Database from "better-sqlite3";
import { beforeEach, describe, expect, it } from "vitest";
import { schemaStatements } from "@/lib/db/schema";
import {
  backfillFromMailMessages,
  blockSender,
  extractDomain,
  isSenderBlocked,
  linkSenderToVendor,
  listDiscoveredSenders,
  normalizeAddress,
  recordSenderObservation,
  unblockSender,
} from "@/senders/discovered-senders";

function createDb() {
  const db = new Database(":memory:");
  db.pragma("foreign_keys = ON");
  for (const statement of schemaStatements) {
    db.exec(statement);
  }
  return db;
}

describe("discovered senders helpers", () => {
  it("normalizes addresses to trimmed lowercase", () => {
    expect(normalizeAddress("  Foo@Bar.COM ")).toBe("foo@bar.com");
    expect(normalizeAddress("")).toBeNull();
    expect(normalizeAddress(undefined)).toBeNull();
  });

  it("extracts the domain part", () => {
    expect(extractDomain("noreply@stripe.com")).toBe("stripe.com");
    expect(extractDomain("no-at-sign")).toBe("");
  });
});

describe("recordSenderObservation", () => {
  let db: ReturnType<typeof createDb>;
  beforeEach(() => {
    db = createDb();
  });

  it("creates a new sender row on first observation and increments counters on repeats", () => {
    const first = recordSenderObservation(db, {
      fromAddress: "billing@OpenAI.com",
      displayName: "OpenAI Billing",
      hadPdfAttachments: true,
      pdfsImported: 1,
    });
    expect(first.blocked).toBe(false);

    recordSenderObservation(db, {
      fromAddress: "billing@openai.com",
      displayName: null,
      hadPdfAttachments: true,
      pdfsImported: 0,
    });

    const all = listDiscoveredSenders(db);
    expect(all).toHaveLength(1);
    expect(all[0].fromAddress).toBe("billing@openai.com");
    expect(all[0].fromDomain).toBe("openai.com");
    expect(all[0].displayName).toBe("OpenAI Billing");
    expect(all[0].mailCount).toBe(2);
    expect(all[0].pdfCount).toBe(2);
    expect(all[0].importedCount).toBe(1);
  });

  it("counts blocked skips separately and does not import", () => {
    recordSenderObservation(db, {
      fromAddress: "spam@example.com",
      hadPdfAttachments: true,
      pdfsImported: 0,
      blockedSkip: true,
    });

    const sender = listDiscoveredSenders(db)[0];
    expect(sender.blockedCount).toBe(1);
    expect(sender.importedCount).toBe(0);
  });
});

describe("block and link helpers", () => {
  let db: ReturnType<typeof createDb>;
  beforeEach(() => {
    db = createDb();
    recordSenderObservation(db, {
      fromAddress: "ops@vendor.com",
      hadPdfAttachments: true,
      pdfsImported: 0,
    });
  });

  it("blocks and unblocks a sender", () => {
    const sender = listDiscoveredSenders(db)[0];
    expect(isSenderBlocked(db, "ops@vendor.com")).toBe(false);

    blockSender(db, sender.id, "Werbung");
    expect(isSenderBlocked(db, "OPS@VENDOR.COM")).toBe(true);
    expect(listDiscoveredSenders(db)[0].blockedReason).toBe("Werbung");

    unblockSender(db, sender.id);
    expect(isSenderBlocked(db, "ops@vendor.com")).toBe(false);
  });

  it("links a sender to a vendor", () => {
    const sender = listDiscoveredSenders(db)[0];
    db.prepare(
      `INSERT INTO vendors (name, canonical_key, category) VALUES ('Vendor', 'vendor', 'service')`,
    ).run();
    const vendorId = (db.prepare(`SELECT id FROM vendors WHERE canonical_key = 'vendor'`).get() as {
      id: number;
    }).id;

    linkSenderToVendor(db, sender.id, vendorId);
    const updated = listDiscoveredSenders(db)[0];
    expect(updated.matchedVendorId).toBe(vendorId);
    expect(updated.matchedVendorName).toBe("Vendor");
  });
});

describe("backfillFromMailMessages", () => {
  it("aggregates mail_messages into discovered_senders", () => {
    const db = createDb();
    db.prepare(
      `INSERT INTO mail_accounts (label, host, port, secure, username, status)
       VALUES ('Primary IMAP', 'imap.example.com', 993, 1, 'user', 'configured')`,
    ).run();
    const accountId = (db.prepare(`SELECT id FROM mail_accounts LIMIT 1`).get() as { id: number }).id;

    db.prepare(
      `INSERT INTO mail_messages (mail_account_id, mailbox, uid, uidvalidity, from_address, status)
       VALUES (?, 'INBOX', 1, 'v1', 'a@x.com', 'processed')`,
    ).run(accountId);
    db.prepare(
      `INSERT INTO mail_messages (mail_account_id, mailbox, uid, uidvalidity, from_address, status)
       VALUES (?, 'INBOX', 2, 'v1', 'A@X.com', 'no_pdf')`,
    ).run(accountId);
    db.prepare(
      `INSERT INTO mail_messages (mail_account_id, mailbox, uid, uidvalidity, from_address, status)
       VALUES (?, 'INBOX', 3, 'v1', 'b@y.com', 'no_new_invoice')`,
    ).run(accountId);

    const result = backfillFromMailMessages(db);
    expect(result.scanned).toBe(2);
    expect(result.upserts).toBe(2);

    const senders = listDiscoveredSenders(db);
    expect(senders.map((s) => s.fromAddress).sort()).toEqual(["a@x.com", "b@y.com"]);
    const a = senders.find((s) => s.fromAddress === "a@x.com")!;
    expect(a.mailCount).toBe(2);
    expect(a.importedCount).toBe(1);
  });
});
