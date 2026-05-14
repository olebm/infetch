import { format } from "date-fns";
import { describe, expect, it } from "vitest";
import { sql } from "@/lib/db/client";
import { runMissingInvoiceCheck } from "@/invoices/missing-check";

// NOTE: runMissingInvoiceCheck now uses the global postgres sql client.
// This test requires a real Postgres connection with seeded vendor data.

async function getVendorId(canonicalKey: string): Promise<number> {
  const rows = await sql<{ id: number }[]>`SELECT id FROM vendors WHERE canonical_key = ${canonicalKey}`;
  if (!rows[0]) throw new Error(`vendor ${canonicalKey} not found`);
  return rows[0].id;
}

describe("missing invoice check", () => {
  it("marks manual invoices as found and missing months as portal required", async () => {
    const openAiId = await getVendorId("openai");
    const currentMonth = format(new Date(), "yyyy-MM");

    // Insert a manual invoice for the current month
    await sql`
      INSERT INTO invoices (vendor_id, source, status, invoice_date, confidence, dedupe_key)
      VALUES (${openAiId}, 'manual', 'ready', ${currentMonth + "-01"}, 0.9, ${"manual-hash-" + Date.now()})
    `;

    const result = await runMissingInvoiceCheck();

    const openAiRows = await sql<{ manualStatus: string; finalStatus: string; sourceUsed: string }[]>`
      SELECT manual_status AS "manualStatus", final_status AS "finalStatus", source_used AS "sourceUsed"
      FROM vendor_month_status
      WHERE vendor_id = ${openAiId} AND year_month = ${currentMonth}
    `;
    const requiredRows = await sql<{ count: string }[]>`
      SELECT COUNT(*) AS count FROM vendor_month_status WHERE portal_status = 'required'
    `;
    const syncRunRows = await sql<{ status: string }[]>`
      SELECT status FROM sync_runs WHERE id = ${result.syncRunId}
    `;

    expect(openAiRows[0]).toEqual({
      manualStatus: "imported",
      finalStatus: "found",
      sourceUsed: "manual",
    });
    expect(Number(requiredRows[0].count)).toBeGreaterThan(0);
    expect(syncRunRows[0].status).toBe("succeeded");
  });
});
