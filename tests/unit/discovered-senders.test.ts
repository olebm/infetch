import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { sql } from "@/lib/db/client";
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

// NOTE: These tests now use the global postgres sql client.
// They require a real Postgres connection (DATABASE_URL env var).

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
  beforeEach(async () => {
    await sql`DELETE FROM discovered_senders WHERE from_address LIKE '%@openai-test.com'`;
  });

  it("creates a new sender row on first observation and increments counters on repeats", async () => {
    const first = await recordSenderObservation({
      fromAddress: "billing@openai-test.com",
      displayName: "OpenAI Billing",
      hadPdfAttachments: true,
      pdfsImported: 1,
    });
    expect(first.blocked).toBe(false);

    await recordSenderObservation({
      fromAddress: "billing@openai-test.com",
      displayName: null,
      hadPdfAttachments: true,
      pdfsImported: 0,
    });

    const all = await listDiscoveredSenders();
    const found = all.filter((s) => s.fromAddress === "billing@openai-test.com");
    expect(found).toHaveLength(1);
    expect(found[0].fromAddress).toBe("billing@openai-test.com");
    expect(found[0].fromDomain).toBe("openai-test.com");
    expect(found[0].displayName).toBe("OpenAI Billing");
    expect(found[0].mailCount).toBe(2);
    expect(found[0].pdfCount).toBe(2);
    expect(found[0].importedCount).toBe(1);
  });

  it("counts blocked skips separately and does not import", async () => {
    await recordSenderObservation({
      fromAddress: "spam@openai-test.com",
      hadPdfAttachments: true,
      pdfsImported: 0,
      blockedSkip: true,
    });

    const all = await listDiscoveredSenders();
    const sender = all.find((s) => s.fromAddress === "spam@openai-test.com")!;
    expect(sender.blockedCount).toBe(1);
    expect(sender.importedCount).toBe(0);
  });
});

describe("block and link helpers", () => {
  beforeEach(async () => {
    await sql`DELETE FROM discovered_senders WHERE from_address = 'ops@vendor-test.com'`;
    await recordSenderObservation({
      fromAddress: "ops@vendor-test.com",
      hadPdfAttachments: true,
      pdfsImported: 0,
    });
  });

  it("blocks and unblocks a sender", async () => {
    const all = await listDiscoveredSenders();
    const sender = all.find((s) => s.fromAddress === "ops@vendor-test.com")!;
    expect(await isSenderBlocked("ops@vendor-test.com")).toBe(false);

    await blockSender(sender.id, "Werbung");
    expect(await isSenderBlocked("OPS@VENDOR-TEST.COM")).toBe(true);
    const allAfterBlock = await listDiscoveredSenders();
    expect(allAfterBlock.find((s) => s.fromAddress === "ops@vendor-test.com")?.blockedReason).toBe("Werbung");

    await unblockSender(sender.id);
    expect(await isSenderBlocked("ops@vendor-test.com")).toBe(false);
  });

  it("links a sender to a vendor", async () => {
    const all = await listDiscoveredSenders();
    const sender = all.find((s) => s.fromAddress === "ops@vendor-test.com")!;

    await sql`
      INSERT INTO vendors (name, canonical_key, category)
      VALUES ('Vendor Test', 'vendor-test', 'service')
      ON CONFLICT(canonical_key) DO NOTHING
    `;
    const vendorRows = await sql<{ id: number }[]>`
      SELECT id FROM vendors WHERE canonical_key = 'vendor-test'
    `;
    const vendorId = vendorRows[0].id;

    await linkSenderToVendor(sender.id, vendorId);
    const updated = await listDiscoveredSenders();
    const updatedSender = updated.find((s) => s.fromAddress === "ops@vendor-test.com")!;
    expect(updatedSender.matchedVendorId).toBe(vendorId);
    expect(updatedSender.matchedVendorName).toBe("Vendor Test");
  });
});

describe("backfillFromMailMessages", () => {
  afterEach(async () => {
    await sql`DELETE FROM mail_messages WHERE from_address LIKE '%@test-backfill.com'`;
    await sql`DELETE FROM discovered_senders WHERE from_address LIKE '%@test-backfill.com'`;
    await sql`DELETE FROM mail_accounts WHERE label = 'Primary IMAP Test' AND host = 'imap.example-test.com'`;
  });

  it("aggregates mail_messages into discovered_senders", async () => {
    // Cleanup leftover from prior runs before inserting
    await sql`DELETE FROM mail_messages WHERE from_address LIKE '%@test-backfill.com'`;
    await sql`DELETE FROM mail_accounts WHERE label = 'Primary IMAP Test' AND host = 'imap.example-test.com'`;

    const accountRows = await sql<{ id: number }[]>`
      INSERT INTO mail_accounts (label, host, port, secure, username, status)
      VALUES ('Primary IMAP Test', 'imap.example-test.com', 993, true, 'user-test', 'configured')
      RETURNING id
    `;
    const accountId = accountRows[0].id;

    await sql`
      INSERT INTO mail_messages (mail_account_id, mailbox, uid, uidvalidity, from_address, status)
      VALUES
        (${accountId}, 'INBOX', 100, 'v1', 'a@test-backfill.com', 'processed'),
        (${accountId}, 'INBOX', 101, 'v1', 'A@test-backfill.com', 'no_pdf'),
        (${accountId}, 'INBOX', 102, 'v1', 'b@test-backfill.com', 'no_new_invoice')
    `;

    const result = await backfillFromMailMessages();
    expect(result.scanned).toBeGreaterThanOrEqual(2);
    expect(result.upserts).toBeGreaterThanOrEqual(2);
  });
});
