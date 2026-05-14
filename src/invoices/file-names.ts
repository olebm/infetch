import fs from "node:fs";
import path from "node:path";
import { sql } from "@/lib/db/client";
import { deriveInvoiceProductLabel } from "@/invoices/product-label";
import { buildInvoiceStoragePath } from "@/invoices/storage";

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

async function syncStoredInvoiceFileRows(files: InvoiceFileRow[]): Promise<{ updated: number; skipped: number }> {
  let updated = 0;
  let skipped = 0;

  for (const file of files) {
    if (!fs.existsSync(file.storedPath)) {
      skipped += 1;
      continue;
    }

    const rawText = readRawText(file.rawTextPath);
    const productLabel = deriveInvoiceProductLabel({
      vendorKey: file.vendorKey,
      originalFilename: file.originalFilename,
      text: rawText,
    });
    const nextPath = buildInvoiceStoragePath({
      originalFilename: file.originalFilename,
      vendorKey: file.vendorKey,
      productLabel,
      invoiceDate: file.invoiceDate,
      fallbackDate: file.createdAt.slice(0, 10),
      currentPath: file.storedPath,
    });

    if (nextPath === file.storedPath) continue;

    fs.mkdirSync(path.dirname(nextPath), { recursive: true, mode: 0o700 });
    fs.renameSync(file.storedPath, nextPath);
    await sql`UPDATE invoice_files SET stored_path = ${nextPath} WHERE id = ${file.id}`;
    updated += 1;
  }

  return { updated, skipped };
}

function readRawText(rawTextPath: string | null) {
  if (!rawTextPath || !fs.existsSync(rawTextPath)) return "";
  return fs.readFileSync(rawTextPath, "utf8");
}
