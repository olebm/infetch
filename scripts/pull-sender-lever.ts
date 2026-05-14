import { getDb } from "../src/lib/db/client";
import { autoAssignSenders } from "../src/senders/discovered-senders";
import { rematchUnmatchedInvoices } from "../src/vendors/auto-alias";
import { matchVendor } from "../src/vendors/matcher";

const db = getDb();

const before = db
  .prepare(
    `SELECT
       COUNT(*) AS total,
       SUM(CASE WHEN matched_vendor_id IS NULL AND blocked = 0 THEN 1 ELSE 0 END) AS unmatched,
       SUM(CASE WHEN matched_vendor_id IS NOT NULL THEN 1 ELSE 0 END) AS matched,
       SUM(CASE WHEN blocked = 1 THEN 1 ELSE 0 END) AS blocked
     FROM discovered_senders`,
  )
  .get() as { total: number; unmatched: number; matched: number; blocked: number };

console.log("\n=== Sender-Hebel ziehen ===\n");
console.log(`Vorher: ${before.total} Sender (${before.matched} matched, ${before.unmatched} ohne Vendor, ${before.blocked} blockiert)\n`);

console.log("Schritt 1: Auto-Zuordnen ...");
const auto = autoAssignSenders(db);
console.log(
  `  geprüft: ${auto.scanned} · zugeordnet: ${auto.matched} · Vendor neu angelegt: ${auto.created} · ohne PDFs übersprungen: ${auto.skipped}\n`,
);

console.log("Schritt 2: Re-Match Rechnungen ...");
const rematch = rematchUnmatchedInvoices(db, matchVendor);
console.log(
  `  geprüft: ${rematch.scanned} · neu zugeordnet: ${rematch.matched} · offen geblieben: ${rematch.unchanged}\n`,
);

const after = db
  .prepare(
    `SELECT
       COUNT(*) AS total,
       SUM(CASE WHEN matched_vendor_id IS NULL AND blocked = 0 THEN 1 ELSE 0 END) AS unmatched,
       SUM(CASE WHEN matched_vendor_id IS NOT NULL THEN 1 ELSE 0 END) AS matched,
       SUM(CASE WHEN blocked = 1 THEN 1 ELSE 0 END) AS blocked
     FROM discovered_senders`,
  )
  .get() as { total: number; unmatched: number; matched: number; blocked: number };

console.log(`Nachher: ${after.total} Sender (${after.matched} matched, ${after.unmatched} ohne Vendor, ${after.blocked} blockiert)`);
console.log(`\nDelta: -${before.unmatched - after.unmatched} aus 'Ohne Vendor' eliminiert.\n`);
