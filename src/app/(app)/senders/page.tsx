import { SendersView } from "@/components/senders/senders-view";
import {
  listSendersWithStats,
  getVendorInvoices,
  type VendorInvoiceRow,
} from "@/lib/db/queries";

export const dynamic = "force-dynamic";

export default async function SendersPage({
  searchParams,
}: {
  searchParams: Promise<{ sender?: string }>;
}) {
  const params = await searchParams;
  const senders = listSendersWithStats();

  const selectedId = params.sender ? Number(params.sender) : null;
  let vendorInvoices: VendorInvoiceRow[] | null = null;

  if (selectedId) {
    const sender = senders.find((s) => s.id === selectedId);
    if (sender?.matchedVendorId) {
      vendorInvoices = getVendorInvoices(sender.matchedVendorId);
    } else if (sender) {
      // Sender exists but has no matched vendor → empty invoice list
      vendorInvoices = [];
    }
  }

  return (
    <div className="screen-enter screen-enter-active">
      <SendersView
        senders={senders}
        selectedSenderId={selectedId}
        vendorInvoices={vendorInvoices}
      />
    </div>
  );
}
