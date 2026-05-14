import Database from "better-sqlite3";
import { describe, expect, it } from "vitest";
import { schemaStatements } from "@/lib/db/schema";
import { seedDatabase } from "@/vendors/seed";
import { provisionAutoApprovalRules } from "@/lib/automation/self-provisioning";
import { reevaluateReviewQueue } from "@/lib/automation/reeval-queue";
import { escalateStuckReviews } from "@/lib/automation/stuck-escalation";
import { evaluateAutoApproval } from "@/lib/automation/auto-approval";
import { resolveInvoiceStatusFromAi } from "@/ai/extract-invoice";
import { isSenderAutoIgnored } from "@/senders/discovered-senders";
import { classifyFilenameAsJunk } from "@/invoices/filename-junk-filter";
import { backfillDomainAliases } from "@/lib/automation/alias-backfill";
import { isLocalExtractionSufficient } from "@/invoices/import-pipeline";
import type { InvoiceAiExtraction } from "@/ai/schemas";

function createDb() {
  const db = new Database(":memory:");
  db.pragma("foreign_keys = ON");
  for (const statement of schemaStatements) {
    db.exec(statement);
  }
  seedDatabase(db);
  return db;
}

function getVendorId(db: Database.Database, canonicalKey: string): number {
  const row = db
    .prepare(`SELECT id FROM vendors WHERE canonical_key = ?`)
    .get(canonicalKey) as { id: number } | undefined;
  if (!row) throw new Error(`vendor ${canonicalKey} not seeded`);
  return row.id;
}

function insertInvoice(
  db: Database.Database,
  input: {
    vendorId: number;
    status: string;
    amount?: number | null;
    extraction?: Partial<InvoiceAiExtraction>;
  },
): number {
  const result = db
    .prepare(
      `INSERT INTO invoices (vendor_id, source, status, invoice_number, invoice_date, amount_gross, currency, confidence, dedupe_key)
       VALUES (?, 'manual', ?, ?, ?, ?, 'EUR', 0.95, ?)`,
    )
    .run(
      input.vendorId,
      input.status,
      "INV-" + Math.random().toString(36).slice(2, 10),
      "2026-05-01",
      input.amount ?? 29,
      "dedupe-" + Math.random().toString(36).slice(2, 12),
    );
  const invoiceId = Number(result.lastInsertRowid);

  if (input.extraction) {
    const full: InvoiceAiExtraction = {
      vendor: "Test",
      invoice_number: "INV-1",
      invoice_date: "2026-05-01",
      service_period_start: null,
      service_period_end: null,
      amount_gross: input.amount ?? 29,
      amount_net: null,
      vat_amount: null,
      currency: "EUR",
      vendor_confidence: null,
      date_confidence: null,
      amount_confidence: null,
      confidence: 0.95,
      notes: null,
      needs_review: false,
      document_type: "invoice",
      ...input.extraction,
    } as InvoiceAiExtraction;
    db.prepare(
      `INSERT INTO ai_extractions (invoice_id, provider, model, prompt_version, input_hash, output_json, status)
       VALUES (?, 'mistral', 'test-model', 'v1', ?, ?, 'succeeded')`,
    ).run(invoiceId, `hash-${invoiceId}`, JSON.stringify(full));
  }

  return invoiceId;
}

describe("provisionAutoApprovalRules", () => {
  it("creates a rule for a vendor with enough successful imports and no failures", () => {
    const db = createDb();
    const vendorId = getVendorId(db, "openai");
    insertInvoice(db, { vendorId, status: "exported", amount: 20 });
    insertInvoice(db, { vendorId, status: "exported", amount: 30 });
    insertInvoice(db, { vendorId, status: "ready", amount: 25 });

    const result = provisionAutoApprovalRules(db);

    expect(result.provisioned).toHaveLength(1);
    expect(result.provisioned[0].vendorId).toBe(vendorId);
    // max amount (30) * 1.5 multiplier * 100 cents
    expect(result.provisioned[0].maxAmountCents).toBe(4500);
  });

  it("does not create a rule when vendor has failed imports recently", () => {
    const db = createDb();
    const vendorId = getVendorId(db, "openai");
    insertInvoice(db, { vendorId, status: "exported", amount: 20 });
    insertInvoice(db, { vendorId, status: "exported", amount: 30 });
    insertInvoice(db, { vendorId, status: "exported", amount: 25 });
    insertInvoice(db, { vendorId, status: "failed", amount: 99 });

    const result = provisionAutoApprovalRules(db);

    expect(result.provisioned).toHaveLength(0);
  });

  it("is idempotent — does not duplicate when rule already exists", () => {
    const db = createDb();
    const vendorId = getVendorId(db, "openai");
    insertInvoice(db, { vendorId, status: "exported", amount: 20 });
    insertInvoice(db, { vendorId, status: "exported", amount: 30 });
    insertInvoice(db, { vendorId, status: "ready", amount: 25 });

    provisionAutoApprovalRules(db);
    const second = provisionAutoApprovalRules(db);

    expect(second.provisioned).toHaveLength(0);
  });
});

describe("reevaluateReviewQueue", () => {
  it("moves non-invoice documents from needs_review to ignored", () => {
    const db = createDb();
    const vendorId = getVendorId(db, "openai");
    const id = insertInvoice(db, {
      vendorId,
      status: "needs_review",
      extraction: { document_type: "other", review_reason: "AGB document" },
    });

    const result = reevaluateReviewQueue(db);

    expect(result.ignored).toBe(1);
    const row = db.prepare("SELECT status FROM invoices WHERE id = ?").get(id) as { status: string };
    expect(row.status).toBe("ignored");
  });

  it("approves invoices that match a newly provisioned rule", () => {
    const db = createDb();
    const vendorId = getVendorId(db, "openai");

    // Erst Track Record bauen
    insertInvoice(db, { vendorId, status: "exported", amount: 20 });
    insertInvoice(db, { vendorId, status: "exported", amount: 25 });
    insertInvoice(db, { vendorId, status: "exported", amount: 30 });

    // Dann ein needs_review-Eintrag mit fehlender per-field-confidence aber Top-Level OK
    const id = insertInvoice(db, {
      vendorId,
      status: "needs_review",
      amount: 28,
      extraction: {
        document_type: "invoice",
        vendor_confidence: null,
        date_confidence: null,
        amount_confidence: null,
        confidence: 0.95,
      },
    });

    provisionAutoApprovalRules(db);
    const result = reevaluateReviewQueue(db);

    expect(result.approved).toBeGreaterThanOrEqual(1);
    const row = db.prepare("SELECT status FROM invoices WHERE id = ?").get(id) as { status: string };
    expect(row.status).toBe("ready");
  });

  it("leaves invoices unchanged when extraction is missing or undecidable", () => {
    const db = createDb();
    const vendorId = getVendorId(db, "openai");
    const id = insertInvoice(db, { vendorId, status: "needs_review", amount: null });

    const result = reevaluateReviewQueue(db);

    expect(result.unchanged).toBe(1);
    const row = db.prepare("SELECT status FROM invoices WHERE id = ?").get(id) as { status: string };
    expect(row.status).toBe("needs_review");
  });
});

describe("auto-approval per-field-confidence fallback", () => {
  it("approves via high_confidence when per-field is null but top-level >= threshold", () => {
    const db = createDb();
    const vendorId = getVendorId(db, "openai");

    const decision = evaluateAutoApproval(
      db,
      {
        vendor: "OpenAI",
        invoice_number: "INV-1",
        invoice_date: "2026-05-01",
        service_period_start: null,
        service_period_end: null,
        amount_gross: 29,
        amount_net: null,
        vat_amount: null,
        currency: "EUR",
        vendor_confidence: null,
        date_confidence: null,
        amount_confidence: null,
        confidence: 0.95,
        notes: null,
        needs_review: false,
        document_type: "invoice",
      } as InvoiceAiExtraction,
      { vendorId, vendorName: "OpenAI", amountGross: 29, invoiceDate: "2026-05-01" },
    );

    expect(decision.autoApproved).toBe(true);
  });

  it("falls back to rejection when per-field is null and top-level below threshold", () => {
    const db = createDb();
    const vendorId = getVendorId(db, "openai");

    const decision = evaluateAutoApproval(
      db,
      {
        vendor: "OpenAI",
        invoice_number: "INV-1",
        invoice_date: "2026-05-01",
        service_period_start: null,
        service_period_end: null,
        amount_gross: 29,
        amount_net: null,
        vat_amount: null,
        currency: "EUR",
        vendor_confidence: null,
        date_confidence: null,
        amount_confidence: null,
        confidence: 0.8,
        notes: null,
        needs_review: false,
        document_type: "invoice",
      } as InvoiceAiExtraction,
      { vendorId, vendorName: "OpenAI", amountGross: 29, invoiceDate: "2026-05-01" },
    );

    expect(decision.autoApproved).toBe(false);
  });
});

describe("resolveInvoiceStatusFromAi (non-invoice routing)", () => {
  it("returns 'ignored' for document_type='other'", () => {
    const status = resolveInvoiceStatusFromAi(
      {
        vendor: "x",
        invoice_number: null,
        invoice_date: null,
        service_period_start: null,
        service_period_end: null,
        amount_gross: null,
        amount_net: null,
        vat_amount: null,
        currency: null,
        vendor_confidence: null,
        date_confidence: null,
        amount_confidence: null,
        confidence: 0.95,
        notes: null,
        needs_review: true,
        document_type: "other",
      } as InvoiceAiExtraction,
      { vendorId: 1, invoiceDate: null, amountGross: null },
    );

    expect(status).toBe("ignored");
  });

  it("returns 'needs_review' for low-confidence invoices", () => {
    const status = resolveInvoiceStatusFromAi(
      {
        vendor: "x",
        invoice_number: "INV-1",
        invoice_date: "2026-05-01",
        service_period_start: null,
        service_period_end: null,
        amount_gross: 29,
        amount_net: null,
        vat_amount: null,
        currency: "EUR",
        vendor_confidence: null,
        date_confidence: null,
        amount_confidence: null,
        confidence: 0.6,
        notes: null,
        needs_review: false,
        document_type: "invoice",
      } as InvoiceAiExtraction,
      { vendorId: 1, invoiceDate: "2026-05-01", amountGross: 29 },
    );

    expect(status).toBe("needs_review");
  });
});

describe("escalateStuckReviews", () => {
  it("escalates needs_review invoices older than the configured threshold", () => {
    const db = createDb();
    const vendorId = getVendorId(db, "openai");
    db.prepare(
      `INSERT INTO invoices (vendor_id, source, status, invoice_number, invoice_date, amount_gross, currency, dedupe_key, updated_at)
       VALUES (?, 'manual', 'needs_review', 'INV-OLD', '2026-01-01', 50, 'EUR', 'dk-old', datetime('now', '-60 days'))`,
    ).run(vendorId);

    const result = escalateStuckReviews(db);

    expect(result.escalated).toBe(1);
    const row = db.prepare("SELECT status FROM invoices WHERE dedupe_key = 'dk-old'").get() as {
      status: string;
    };
    expect(row.status).toBe("ignored");
  });

  it("leaves fresh needs_review invoices untouched", () => {
    const db = createDb();
    const vendorId = getVendorId(db, "openai");
    db.prepare(
      `INSERT INTO invoices (vendor_id, source, status, invoice_number, invoice_date, amount_gross, currency, dedupe_key)
       VALUES (?, 'manual', 'needs_review', 'INV-NEW', '2026-05-01', 50, 'EUR', 'dk-new')`,
    ).run(vendorId);

    const result = escalateStuckReviews(db);

    expect(result.escalated).toBe(0);
  });
});

describe("isSenderAutoIgnored", () => {
  function seedMailImport(
    db: Database.Database,
    fromAddress: string,
    invoiceStatus: string,
    options: { ageDays?: number } = {},
  ): void {
    const ageClause = options.ageDays !== undefined ? `datetime('now', '-${options.ageDays} days')` : "CURRENT_TIMESTAMP";
    const uidValue = Math.floor(Math.random() * 1_000_000) + 1;
    const mailId = Number(
      db
        .prepare(
          `INSERT INTO mail_messages (mail_account_id, mailbox, uid, uidvalidity, message_id, from_address, subject, status)
           VALUES (1, 'INBOX', ?, '1', ?, ?, 'test', 'processed')`,
        )
        .run(uidValue, `msg-${Math.random()}`, fromAddress).lastInsertRowid,
    );
    const vendorId = getVendorId(db, "openai");
    const invoiceId = Number(
      db
        .prepare(
          `INSERT INTO invoices (vendor_id, source, status, dedupe_key, created_at)
           VALUES (?, 'mail', ?, ?, ${ageClause})`,
        )
        .run(vendorId, invoiceStatus, `dk-${Math.random()}`).lastInsertRowid,
    );
    db.prepare(
      `INSERT INTO invoice_files (invoice_id, original_filename, stored_path, sha256, size_bytes, mime_type, source_type, source_ref_id)
       VALUES (?, ?, ?, ?, 1024, 'application/pdf', 'mail', ?)`,
    ).run(invoiceId, "test.pdf", `/tmp/test-${Math.random()}.pdf`, `sha-${Math.random()}`, String(mailId));
  }

  it("returns true when last 3 mail imports from sender were all ignored", () => {
    const db = createDb();
    db.prepare(`INSERT INTO mail_accounts (id, label, host, port, username, status) VALUES (1, 'primary', 'imap.test', 993, 'me@test', 'configured')`).run();
    seedMailImport(db, "spam@vendor.com", "ignored");
    seedMailImport(db, "spam@vendor.com", "ignored");
    seedMailImport(db, "spam@vendor.com", "ignored");

    expect(isSenderAutoIgnored(db, "spam@vendor.com")).toBe(true);
  });

  it("returns false when sender has a recent successful import", () => {
    const db = createDb();
    db.prepare(`INSERT INTO mail_accounts (id, label, host, port, username, status) VALUES (1, 'primary', 'imap.test', 993, 'me@test', 'configured')`).run();
    seedMailImport(db, "mixed@vendor.com", "ignored");
    seedMailImport(db, "mixed@vendor.com", "ignored");
    seedMailImport(db, "mixed@vendor.com", "exported");

    expect(isSenderAutoIgnored(db, "mixed@vendor.com")).toBe(false);
  });

  it("returns false when fewer than 3 imports exist", () => {
    const db = createDb();
    db.prepare(`INSERT INTO mail_accounts (id, label, host, port, username, status) VALUES (1, 'primary', 'imap.test', 993, 'me@test', 'configured')`).run();
    seedMailImport(db, "new@vendor.com", "ignored");
    seedMailImport(db, "new@vendor.com", "ignored");

    expect(isSenderAutoIgnored(db, "new@vendor.com")).toBe(false);
  });
});

describe("classifyFilenameAsJunk", () => {
  it("matches obvious non-invoice filenames", () => {
    expect(classifyFilenameAsJunk("Widerrufsbelehrung.pdf").isJunk).toBe(true);
    expect(classifyFilenameAsJunk("AGB-2026.pdf").isJunk).toBe(true);
    expect(classifyFilenameAsJunk("boarding-pass-DLH123.pdf").isJunk).toBe(true);
    expect(classifyFilenameAsJunk("terms_of_service.pdf").isJunk).toBe(true);
    expect(classifyFilenameAsJunk("AV-Vertrag-Mistral.pdf").isJunk).toBe(true);
  });

  it("does not match legitimate invoice filenames", () => {
    expect(classifyFilenameAsJunk("Rechnung-2026-04-Hetzner.pdf").isJunk).toBe(false);
    expect(classifyFilenameAsJunk("Invoice-1QSTFKNA-0005.pdf").isJunk).toBe(false);
    expect(classifyFilenameAsJunk("Receipt-2767.pdf").isJunk).toBe(false);
    expect(classifyFilenameAsJunk(null).isJunk).toBe(false);
  });
});

describe("isLocalExtractionSufficient (relaxed threshold)", () => {
  it("accepts a contains-match (0.72) when amount and date are present", () => {
    const result = isLocalExtractionSufficient(
      0.72,
      { invoiceDate: "2026-05-01", amountGross: 29 },
      { error: null },
      0.85,
    );
    expect(result).toBe(true);
  });

  it("rejects when vendor confidence too low", () => {
    const result = isLocalExtractionSufficient(
      0.5,
      { invoiceDate: "2026-05-01", amountGross: 29 },
      { error: null },
      0.85,
    );
    expect(result).toBe(false);
  });

  it("rejects when core field missing", () => {
    const result = isLocalExtractionSufficient(
      0.9,
      { invoiceDate: null, amountGross: 29 },
      { error: null },
      0.85,
    );
    expect(result).toBe(false);
  });
});

describe("backfillDomainAliases", () => {
  it("creates a domain alias for vendor that only has contains-aliases", () => {
    const db = createDb();
    db.prepare(`INSERT INTO mail_accounts (id, label, host, port, username, status) VALUES (1, 'primary', 'imap.test', 993, 'me@test', 'configured')`).run();

    const vendorId = getVendorId(db, "openai");
    // OpenAI seeded mit contains-Alias, kein domain → Kandidat für Backfill
    db.prepare(`DELETE FROM vendor_aliases WHERE vendor_id = ? AND match_type = 'domain'`).run(vendorId);

    const mailId = Number(
      db
        .prepare(
          `INSERT INTO mail_messages (mail_account_id, mailbox, uid, uidvalidity, message_id, from_address, subject, status)
           VALUES (1, 'INBOX', 1, '1', 'msg-1', 'billing@openai.com', 'invoice', 'processed')`,
        )
        .run().lastInsertRowid,
    );
    const invId = Number(
      db
        .prepare(
          `INSERT INTO invoices (vendor_id, source, status, dedupe_key) VALUES (?, 'mail', 'exported', ?)`,
        )
        .run(vendorId, "dk-1").lastInsertRowid,
    );
    db.prepare(
      `INSERT INTO invoice_files (invoice_id, original_filename, stored_path, sha256, size_bytes, mime_type, source_type, source_ref_id)
       VALUES (?, 'inv.pdf', '/tmp/inv.pdf', 'sha-1', 100, 'application/pdf', 'mail', ?)`,
    ).run(invId, String(mailId));

    const result = backfillDomainAliases(db);

    expect(result.aliasesAdded).toBe(1);
    expect(result.details[0].alias).toBe("openai.com");
  });

  it("is idempotent — does not re-add existing aliases", () => {
    const db = createDb();
    db.prepare(`INSERT INTO mail_accounts (id, label, host, port, username, status) VALUES (1, 'primary', 'imap.test', 993, 'me@test', 'configured')`).run();
    const vendorId = getVendorId(db, "openai");
    db.prepare(`DELETE FROM vendor_aliases WHERE vendor_id = ? AND match_type = 'domain'`).run(vendorId);

    const mailId = Number(
      db
        .prepare(
          `INSERT INTO mail_messages (mail_account_id, mailbox, uid, uidvalidity, message_id, from_address, subject, status)
           VALUES (1, 'INBOX', 1, '1', 'msg-1', 'billing@openai.com', 'invoice', 'processed')`,
        )
        .run().lastInsertRowid,
    );
    const invId = Number(
      db
        .prepare(
          `INSERT INTO invoices (vendor_id, source, status, dedupe_key) VALUES (?, 'mail', 'exported', ?)`,
        )
        .run(vendorId, "dk-2").lastInsertRowid,
    );
    db.prepare(
      `INSERT INTO invoice_files (invoice_id, original_filename, stored_path, sha256, size_bytes, mime_type, source_type, source_ref_id)
       VALUES (?, 'inv.pdf', '/tmp/inv.pdf', 'sha-2', 100, 'application/pdf', 'mail', ?)`,
    ).run(invId, String(mailId));

    backfillDomainAliases(db);
    const second = backfillDomainAliases(db);
    expect(second.aliasesAdded).toBe(0);
  });
});
