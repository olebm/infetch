import { InvoiceInboxView } from "@/components/invoice-inbox/invoice-inbox-view";

export const dynamic = "force-dynamic";

export default async function InvoicesPage({
  searchParams,
}: {
  searchParams: Promise<{ tab?: string; year?: string; q?: string }>;
}) {
  const params = await searchParams;
  return <InvoiceInboxView tab={params.tab} year={params.year} search={params.q} />;
}
