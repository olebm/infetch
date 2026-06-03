import path from "node:path";
import {
  getInvoiceDetail,
  getInvoiceReviewOptions,
  getVendors,
  getAdjacentInvoiceIds,
} from "@/lib/db/queries";
import { getVendorSuggestions } from "@/vendors/suggestions";
import { getExportTargets } from "@/exports/export-pipeline";
import { getCurrentAuth } from "@/lib/auth/current";
import { InvoiceReviewForm } from "@/components/invoice-review/invoice-review-form";

export async function InvoiceReviewView({
  invoiceId,
  organizationId,
}: {
  invoiceId: number;
  organizationId?: string | null;
}) {
  const auth = await getCurrentAuth();
  const orgId = organizationId !== undefined ? organizationId : (auth?.organization?.id ?? null);

  const invoice = await getInvoiceDetail(invoiceId, orgId);

  if (!invoice) {
    return null;
  }

  const [vendors, duplicateCandidates, vendorSuggestions, exportTargetsAll, adjacent] =
    await Promise.all([
      getVendors(orgId),
      getInvoiceReviewOptions(invoiceId, 50, orgId),
      getVendorSuggestions(invoiceId, 3, orgId),
      getExportTargets(orgId),
      getAdjacentInvoiceIds(invoiceId, undefined, orgId),
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
