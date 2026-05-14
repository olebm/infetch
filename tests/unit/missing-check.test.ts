import Database from "better-sqlite3";
import { format } from "date-fns";
import { describe, expect, it } from "vitest";
import { runMissingInvoiceCheck } from "@/invoices/missing-check";
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

function getVendorId(db: Database.Database, canonicalKey: string) {
  return (db.prepare(`SELECT id FROM vendors WHERE canonical_key = ?`).get(canonicalKey) as { id: number }).id;
}

describe("missing invoice check", () => {
  it("marks manual invoices as found and missing months as portal required", () => {
    const db = createDb();
    const openAiId = getVendorId(db, "openai");
    const currentMonth = format(new Date(), "yyyy-MM");

    db.prepare(
      `INSERT INTO invoices (vendor_id, source, status, invoice_date, confidence, dedupe_key)
       VALUES (?, 'manual', 'ready', ?, 0.9, 'manual-hash')`,
    ).run(openAiId, `${currentMonth}-01`);

    const result = runMissingInvoiceCheck(db);
    const openAiStatus = db
      .prepare(
        `SELECT manual_status AS manualStatus, final_status AS finalStatus, source_used AS sourceUsed
         FROM vendor_month_status
         WHERE vendor_id = ? AND year_month = ?`,
      )
      .get(openAiId, currentMonth) as { manualStatus: string; finalStatus: string; sourceUsed: string };
    const requiredCount = (
      db.prepare(`SELECT COUNT(*) AS count FROM vendor_month_status WHERE portal_status = 'required'`).get() as {
        count: number;
      }
    ).count;
    const syncRun = db.prepare(`SELECT status FROM sync_runs WHERE id = ?`).get(result.syncRunId) as { status: string };

    expect(openAiStatus).toEqual({
      manualStatus: "imported",
      finalStatus: "found",
      sourceUsed: "manual",
    });
    expect(requiredCount).toBeGreaterThan(0);
    expect(syncRun.status).toBe("succeeded");
  });
});
