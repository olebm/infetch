import path from "node:path";
import { getInvoiceDetail, getInvoiceReviewOptions, getVendors, getAdjacentInvoiceIds } from "@/lib/db/queries";
import { getVendorSuggestions } from "@/vendors/suggestions";
import { getExportTargets } from "@/exports/export-pipeline";
import { getDb } from "@/lib/db/client";
import { InvoiceReviewForm } from "@/components/invoice-review/invoice-review-form";

export function InvoiceReviewView({ invoiceId }: { invoiceId: number }) {
  const invoice = getInvoiceDetail(invoiceId);

  if (!invoice) {
    return null;
  }

  const db = getDb();
  const vendors = getVendors().map((vendor) => ({ id: vendor.id, name: vendor.name }));
  const duplicateCandidates = getInvoiceReviewOptions(invoiceId);
  const vendorSuggestions = getVendorSuggestions(db, invoiceId, 3);
  const exportTargets = getExportTargets(db).filter((t) => t.enabled && t.recipientEmail);
  const adjacent = getAdjacentInvoiceIds(invoiceId);

  const invoiceWithDisplayNames = {
    ...invoice,
    files: invoice.files.map((file) => ({
      ...file,
      displayFilename: path.basename(file.storedPath),
    })),
  };

  return (
    <InvoiceReviewForm
      invoice={invoiceWithDisplayNames}
      vendors={vendors}
      duplicateCandidates={duplicateCandidates}
      vendorSuggestions={vendorSuggestions}
      exportTargets={exportTargets}
      adjacent={adjacent}
    />
  );
}
