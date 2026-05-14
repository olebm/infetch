import path from "node:path";
import { getInvoiceDetail, getInvoiceReviewOptions, getVendors, getAdjacentInvoiceIds } from "@/lib/db/queries";
import { getVendorSuggestions } from "@/vendors/suggestions";
import { getExportTargets } from "@/exports/export-pipeline";
import { InvoiceReviewForm } from "@/components/invoice-review/invoice-review-form";

export async function InvoiceReviewView({ invoiceId }: { invoiceId: number }) {
  const invoice = await getInvoiceDetail(invoiceId);

  if (!invoice) {
    return null;
  }

  const [vendors, duplicateCandidates, vendorSuggestions, exportTargetsAll, adjacent] = await Promise.all([
    getVendors(),
    getInvoiceReviewOptions(invoiceId),
    getVendorSuggestions(invoiceId, 3),
    getExportTargets(),
    getAdjacentInvoiceIds(invoiceId),
  ]);

  const exportTargets = exportTargetsAll.filter((t) => t.enabled && t.recipientEmail);

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
      vendors={vendors.map((vendor) => ({ id: vendor.id, name: vendor.name }))}
      duplicateCandidates={duplicateCandidates}
      vendorSuggestions={vendorSuggestions}
      exportTargets={exportTargets}
      adjacent={adjacent}
    />
  );
}
