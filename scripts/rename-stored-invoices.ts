import { getDb } from "../src/lib/db/client";
import { syncAllStoredInvoiceFileNames } from "../src/invoices/file-names";

const db = getDb();
const result = syncAllStoredInvoiceFileNames(db);

console.log(`Stored invoice PDFs renamed: ${result.updated} updated, ${result.skipped} skipped.`);
