import { sql } from "../src/lib/db/client";
import { syncAllStoredInvoiceFileNames } from "../src/invoices/file-names";

const result = await syncAllStoredInvoiceFileNames();

console.log(`Stored invoice PDFs renamed: ${result.updated} updated, ${result.skipped} skipped.`);
await sql.end();
