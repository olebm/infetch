import { notFound } from "next/navigation";
import { getInvoiceDetail } from "@/lib/db/queries";
import { requireCurrentAuth } from "@/lib/auth/current";
import { InvoiceReviewView } from "@/components/invoice-review/invoice-review-view";

export const dynamic = "force-dynamic";

export default async function InvoiceDetailPage({
  params,
}: {
  params: Promise<{ invoiceId: string }>;
}) {
  const { invoiceId } = await params;
  const numericInvoiceId = Number(invoiceId);

  if (!Number.isInteger(numericInvoiceId) || numericInvoiceId <= 0) {
    notFound();
  }

  const auth = await requireCurrentAuth();
  const organizationId = auth.organization?.id ?? null;

  if (!(await getInvoiceDetail(numericInvoiceId, organizationId))) {
    notFound();
  }

  return <InvoiceReviewView invoiceId={numericInvoiceId} organizationId={organizationId} />;
}
