import Database from "better-sqlite3";
import { describe, expect, it } from "vitest";
import { schemaStatements } from "@/lib/db/schema";
import { seedDatabase } from "@/vendors/seed";
import { evaluateAutoApproval } from "@/lib/automation/auto-approval";
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

function buildExtraction(overrides: Partial<InvoiceAiExtraction>): InvoiceAiExtraction {
  return {
    vendor: "OpenAI",
    invoice_number: "INV-1",
    invoice_date: "2026-05-01",
    service_period_start: null,
    service_period_end: null,
    amount_gross: 29,
    amount_net: 24.37,
    vat_amount: 4.63,
    currency: "EUR",
    vendor_confidence: 0.99,
    date_confidence: 0.99,
    amount_confidence: 0.99,
    confidence: 0.99,
    notes: null,
    needs_review: false,
    ...overrides,
  };
}

describe("evaluateAutoApproval", () => {
  it("auto-approves via high_confidence when all fields exceed threshold (no rule needed)", () => {
    const db = createDb();
    const vendorId = getVendorId(db, "openai");

    const decision = evaluateAutoApproval(
      db,
      buildExtraction({ vendor_confidence: 0.95, date_confidence: 0.95, amount_confidence: 0.95 }),
      { vendorId, vendorName: "OpenAI", amountGross: 29, invoiceDate: "2026-05-01" },
    );

    expect(decision.autoApproved).toBe(true);
    if (decision.autoApproved) {
      expect(decision.via).toBe("high_confidence");
      expect(decision.ruleId).toBeNull();
    }
  });

  it("rejects when one per-field confidence dips below the auto-pilot threshold and no rule exists", () => {
    const db = createDb();
    const vendorId = getVendorId(db, "openai");

    const decision = evaluateAutoApproval(
      db,
      buildExtraction({ amount_confidence: 0.8 }),
      { vendorId, vendorName: "OpenAI", amountGross: 29, invoiceDate: "2026-05-01" },
    );

    expect(decision.autoApproved).toBe(false);
  });

  it("rejects when mistral flagged needs_review even at high confidence", () => {
    const db = createDb();
    const vendorId = getVendorId(db, "openai");

    const decision = evaluateAutoApproval(
      db,
      buildExtraction({ needs_review: true }),
      { vendorId, vendorName: "OpenAI", amountGross: 29, invoiceDate: "2026-05-01" },
    );

    expect(decision.autoApproved).toBe(false);
    if (!decision.autoApproved) {
      expect(decision.reason).toMatch(/needs_review/);
    }
  });

  it("rejects when core fields are missing", () => {
    const db = createDb();
    const vendorId = getVendorId(db, "openai");

    const decision = evaluateAutoApproval(
      db,
      buildExtraction({}),
      { vendorId, vendorName: "OpenAI", amountGross: null, invoiceDate: "2026-05-01" },
    );

    expect(decision.autoApproved).toBe(false);
  });
});
