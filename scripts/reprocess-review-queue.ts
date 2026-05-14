import { sql } from "../src/lib/db/client";
import { evaluateAutoApproval } from "../src/lib/automation/auto-approval";
import type { InvoiceAiExtraction } from "../src/ai/schemas";

const beforeRows = await sql<{ c: string }[]>`SELECT COUNT(*) AS c FROM invoices WHERE status = 'needs_review'`;
const beforeCount = Number(beforeRows[0].c);
console.log(`Vorher in needs_review: ${beforeCount}\n`);

type Row = {
  id: number;
  vendor_id: number | null;
  vendor_name: string | null;
  invoice_date: string | null;
  amount_gross: number | null;
  output_json: string | null;
};

const rows = await sql<Row[]>`
  SELECT i.id, i.vendor_id, v.name AS vendor_name, i.invoice_date, i.amount_gross, ae.output_json
  FROM invoices i
  LEFT JOIN vendors v ON v.id = i.vendor_id
  LEFT JOIN ai_extractions ae ON ae.invoice_id = i.id AND ae.status = 'succeeded'
  WHERE i.status = 'needs_review'
`;

const INVOICE_TYPES = new Set(["invoice", "receipt", "payment_confirmation", "credit_note"]);

let ignored = 0;
let approved = 0;
let unchanged = 0;
const reasonCounts: Record<string, number> = {};

for (const row of rows) {
  if (!row.output_json) {
    unchanged++;
    reasonCounts["no_extraction"] = (reasonCounts["no_extraction"] || 0) + 1;
    continue;
  }
  const extraction = JSON.parse(row.output_json) as InvoiceAiExtraction;

  // Step 1: Non-Rechnungen → 'ignored'
  if (!INVOICE_TYPES.has(extraction.document_type)) {
    await sql`UPDATE invoices SET status = 'ignored', updated_at = CURRENT_TIMESTAMP WHERE id = ${row.id}`;
    ignored++;
    continue;
  }

  // Step 2: Echte Rechnungen → Auto-Approval-Logik erneut anwenden
  const decision = await evaluateAutoApproval(extraction, {
    vendorId: row.vendor_id,
    vendorName: row.vendor_name,
    amountGross: row.amount_gross,
    invoiceDate: row.invoice_date,
  });

  if (decision.autoApproved) {
    await sql`UPDATE invoices SET status = 'ready', updated_at = CURRENT_TIMESTAMP WHERE id = ${row.id}`;
    approved++;
  } else {
    unchanged++;
    reasonCounts[decision.reason] = (reasonCounts[decision.reason] || 0) + 1;
  }
}

const afterRows = await sql<{ c: string }[]>`SELECT COUNT(*) AS c FROM invoices WHERE status = 'needs_review'`;
const afterCount = Number(afterRows[0].c);

console.log(`Verarbeitet: ${rows.length}`);
console.log(`  → 'ignored' (keine Rechnung):  ${ignored}`);
console.log(`  → 'ready' (auto-approved):     ${approved}`);
console.log(`  → unverändert (manueller Review): ${unchanged}`);
console.log(`\nGründe für unverändert:`);
for (const [reason, count] of Object.entries(reasonCounts).sort((a, b) => b[1] - a[1])) {
  console.log(`  ${count}× ${reason}`);
}
console.log(`\nNachher in needs_review: ${afterCount} (Delta: -${beforeCount - afterCount})\n`);
await sql.end();
