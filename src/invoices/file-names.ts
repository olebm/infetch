import { sql } from "@/lib/db/client";

type InvoiceFileRow = {
  id: number;
  originalFilename: string;
  storedPath: string;
  createdAt: string;
  rawTextPath: string | null;
  vendorKey: string | null;
  invoiceDate: string | null;
};

export async function syncStoredInvoiceFileNamesForInvoice(invoiceId: number): Promise<{ updated: number; skipped: number }> {
  const files = await sql<InvoiceFileRow[]>`
    SELECT invoice_files.id, invoice_files.original_filename AS "originalFilename", invoice_files.stored_path AS "storedPath",
      invoice_files.created_at AS "createdAt", invoices.raw_text_path AS "rawTextPath", vendors.canonical_key AS "vendorKey",
      invoices.invoice_date AS "invoiceDate"
    FROM invoice_files
    JOIN invoices ON invoices.id = invoice_files.invoice_id
    LEFT JOIN vendors ON vendors.id = invoices.vendor_id
    WHERE invoice_files.invoice_id = ${invoiceId}
    ORDER BY invoice_files.id ASC
  `;

  return syncStoredInvoiceFileRows(files);
}

export async function syncAllStoredInvoiceFileNames(): Promise<{ updated: number; skipped: number }> {
  const files = await sql<InvoiceFileRow[]>`
    SELECT invoice_files.id, invoice_files.original_filename AS "originalFilename", invoice_files.stored_path AS "storedPath",
      invoice_files.created_at AS "createdAt", invoices.raw_text_path AS "rawTextPath", vendors.canonical_key AS "vendorKey",
      invoices.invoice_date AS "invoiceDate"
    FROM invoice_files
    JOIN invoices ON invoices.id = invoice_files.invoice_id
    LEFT JOIN vendors ON vendors.id = invoices.vendor_id
    ORDER BY invoice_files.id ASC
  `;

  return syncStoredInvoiceFileRows(files);
}

/**
 * File rename/sync is no longer applicable with Supabase Storage.
 * Files are keyed by a deterministic Storage key at upload time.
 * This function is kept as a no-op for backward compatibility.
 */
async function syncStoredInvoiceFileRows(files: InvoiceFileRow[]): Promise<{ updated: number; skipped: number }> {
  void files;
  return { updated: 0, skipped: 0 };
}
