import { sql } from "../src/lib/db/client";
import { autoAssignSenders } from "../src/senders/discovered-senders";
import { rematchUnmatchedInvoices } from "../src/vendors/auto-alias";
import { matchVendor } from "../src/vendors/matcher";

const beforeRows = await sql<
  {
    total: string;
    unmatched: string;
    matched: string;
    blocked: string;
  }[]
>`
  SELECT
    COUNT(*) AS total,
    SUM(CASE WHEN matched_vendor_id IS NULL AND blocked = false THEN 1 ELSE 0 END) AS unmatched,
    SUM(CASE WHEN matched_vendor_id IS NOT NULL THEN 1 ELSE 0 END) AS matched,
    SUM(CASE WHEN blocked = true THEN 1 ELSE 0 END) AS blocked
  FROM discovered_senders
`;
const before = {
  total: Number(beforeRows[0].total),
  unmatched: Number(beforeRows[0].unmatched),
  matched: Number(beforeRows[0].matched),
  blocked: Number(beforeRows[0].blocked),
};

console.log("\n=== Sender-Hebel ziehen ===\n");
console.log(
  `Vorher: ${before.total} Sender (${before.matched} matched, ${before.unmatched} ohne Vendor, ${before.blocked} blockiert)\n`,
);

console.log("Schritt 1: Auto-Zuordnen ...");
const auto = await autoAssignSenders();
console.log(
  `  geprüft: ${auto.scanned} · zugeordnet: ${auto.matched} · Vendor neu angelegt: ${auto.created} · ohne PDFs übersprungen: ${auto.skipped}\n`,
);

console.log("Schritt 2: Re-Match Rechnungen ...");
const rematch = await rematchUnmatchedInvoices(matchVendor);
console.log(
  `  geprüft: ${rematch.scanned} · neu zugeordnet: ${rematch.matched} · offen geblieben: ${rematch.unchanged}\n`,
);

const afterRows = await sql<
  {
    total: string;
    unmatched: string;
    matched: string;
    blocked: string;
  }[]
>`
  SELECT
    COUNT(*) AS total,
    SUM(CASE WHEN matched_vendor_id IS NULL AND blocked = false THEN 1 ELSE 0 END) AS unmatched,
    SUM(CASE WHEN matched_vendor_id IS NOT NULL THEN 1 ELSE 0 END) AS matched,
    SUM(CASE WHEN blocked = true THEN 1 ELSE 0 END) AS blocked
  FROM discovered_senders
`;
const after = {
  total: Number(afterRows[0].total),
  unmatched: Number(afterRows[0].unmatched),
  matched: Number(afterRows[0].matched),
  blocked: Number(afterRows[0].blocked),
};

console.log(
  `Nachher: ${after.total} Sender (${after.matched} matched, ${after.unmatched} ohne Vendor, ${after.blocked} blockiert)`,
);
console.log(`\nDelta: -${before.unmatched - after.unmatched} aus 'Ohne Vendor' eliminiert.\n`);
await sql.end();
