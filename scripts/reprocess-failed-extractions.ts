/**
 * Heilt Bestands-Gutschriften, deren KI-Extraktion vor dem Schema-Fix
 * (INFETCH-238) mit Zod `too_small` auf den Betragsfeldern scheiterte.
 * Lädt den Roh-Text neu und re-extrahiert via Mistral — siehe
 * src/lib/automation/reprocess-failed-extractions.ts.
 *
 * Aufruf:
 *   tsx scripts/reprocess-failed-extractions.ts              # DRY-RUN (Default): nur zählen
 *   tsx scripts/reprocess-failed-extractions.ts --execute    # schreibt + ruft Mistral (kostet)
 *   tsx scripts/reprocess-failed-extractions.ts --execute --limit=5
 *
 * DATABASE_URL der Umgebung entscheidet, welche DB getroffen wird — der
 * Prod-Lauf (--execute gegen Prod-DATABASE_URL + MISTRAL_API_KEY) ist ein
 * bewusstes Gate.
 */
import { sql } from "../src/lib/db/client";
import { reprocessNegativeAmountFailures } from "../src/lib/automation/reprocess-failed-extractions";

const execute = process.argv.includes("--execute");
const limitArg = process.argv.find((a) => a.startsWith("--limit="));
const limit = limitArg ? Number(limitArg.split("=")[1]) : undefined;

console.log(
  execute
    ? "MODE: EXECUTE — re-extrahiert via Mistral und SCHREIBT in die DB (kostet).\n"
    : "MODE: DRY-RUN — nur zählen, KEIN Mistral-Call, KEIN Write. (--execute zum Ausführen)\n",
);

const result = await reprocessNegativeAmountFailures({ dryRun: !execute, limit });

console.log(`Betroffene Belege (scanned): ${result.scanned}`);
if (execute) {
  console.log(`  → geheilt (succeeded):        ${result.healed}`);
  console.log(`  → erneut fehlgeschlagen:      ${result.stillFailed}`);
  console.log(`  → Fehler:                     ${result.errors}`);
}
console.log(`  → ohne raw_text (manuell):    ${result.skippedNoText}`);

if (result.details.length > 0) {
  console.log(`\nDetails:`);
  for (const d of result.details) {
    const amount = d.amountGross != null ? `  amount_gross=${d.amountGross}` : "";
    const note = d.note ? `  (${d.note})` : "";
    console.log(`  #${d.invoiceId}  ${d.outcome}${amount}${note}`);
  }
}

if (!execute && result.scanned > 0) {
  console.log(`\n→ ${result.scanned} Beleg(e) würden re-extrahiert. Mit --execute ausführen.`);
}

await sql.end();
