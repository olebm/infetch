/**
 * Stellt durch die Storage-Key-Kollision (INFETCH-243/244) überschriebene
 * Rechnungs-PDFs wieder her: holt das Original-Attachment per IMAP neu und legt
 * es unter einem neuen eindeutigen Storage-Key ab. Siehe
 * src/lib/automation/recover-overwritten-pdfs.ts.
 *
 * Aufruf:
 *   tsx scripts/recover-overwritten-pdfs.ts --org=<uuid>            # DRY-RUN: Recoverability prüfen
 *   tsx scripts/recover-overwritten-pdfs.ts --org=<uuid> --execute  # schreibt Storage + DB
 *   tsx scripts/recover-overwritten-pdfs.ts --org=<uuid> --execute --limit=3
 *
 * Benötigt Node >= 22 (Supabase-Storage- + IMAP-Client brauchen nativen
 * WebSocket). DRY-RUN macht nur Reads (Storage-Download + IMAP-Fetch), kein
 * Write. Der --execute-Lauf gegen Prod ist ein bewusstes Gate.
 */
import { sql } from "../src/lib/db/client";
import { recoverOverwrittenPdfs } from "../src/lib/automation/recover-overwritten-pdfs";

async function main() {
  const execute = process.argv.includes("--execute");
  const orgArg = process.argv.find((a) => a.startsWith("--org="));
  const organizationId = orgArg ? orgArg.split("=")[1] : null;
  const limitArg = process.argv.find((a) => a.startsWith("--limit="));
  const limit = limitArg ? Number(limitArg.split("=")[1]) : undefined;

  console.log(
    execute
      ? "MODE: EXECUTE — legt wiederhergestellte PDFs ab und SCHREIBT stored_path.\n"
      : "MODE: DRY-RUN — nur Recoverability (Storage-Read + IMAP-Fetch), kein Write. (--execute zum Ausführen)\n",
  );
  if (!organizationId) {
    console.log("Hinweis: ohne --org=<uuid> werden ALLE Orgs betrachtet.\n");
  }

  const r = await recoverOverwrittenPdfs({ dryRun: !execute, organizationId, limit });

  console.log(`Kollidierende Dateien gescannt: ${r.scanned}`);
  console.log(`  Überlebende (ok, kein Handlungsbedarf): ${r.notOverwritten}`);
  console.log(
    execute
      ? `  wiederhergestellt:                     ${r.recovered}`
      : `  wiederherstellbar:                     ${r.recoverable}`,
  );
  console.log(`  NICHT wiederherstellbar:               ${r.unrecoverable}`);

  if (r.details.length > 0) {
    console.log(`\nDetails:`);
    for (const d of r.details) {
      console.log(
        `  #${d.invoiceId} (file ${d.fileId})  ${d.outcome}${d.note ? `  (${d.note})` : ""}`,
      );
    }
  }

  await sql.end();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
