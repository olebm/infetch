import { SendersView } from "@/components/senders/senders-view";
import { getCurrentAuth } from "@/lib/auth/current";
import {
  listSendersWithStats,
  getVendorInvoices,
  getSenderInvoices,
  type VendorInvoiceRow,
} from "@/lib/db/queries";

export const dynamic = "force-dynamic";

export default async function SendersPage({
  searchParams,
}: {
  searchParams: Promise<{ sender?: string }>;
}) {
  const params = await searchParams;
  const auth = await getCurrentAuth();
  const senders = await listSendersWithStats(auth?.organization?.id ?? null);

  const selectedId = params.sender ? Number(params.sender) : null;
  let vendorInvoices: VendorInvoiceRow[] | null = null;

  if (selectedId) {
    const sender = senders.find((s) => s.id === selectedId);
    if (sender?.matchedVendorId) {
      vendorInvoices = await getVendorInvoices(sender.matchedVendorId);
    } else if (sender) {
      // Kein Katalog-Vendor (vendor_id NULL ist Normalfall) → Rechnungen über
      // die Mail-Quelle (Absender-Domain) laden statt leere Liste (INFETCH-218).
      vendorInvoices = await getSenderInvoices(sender.fromDomain, auth?.organization?.id ?? null);
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
