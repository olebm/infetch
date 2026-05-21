import { redirect } from "next/navigation";
import { getCurrentAuth } from "@/lib/auth/current";
import { listDiscoveredSenders } from "@/senders/discovered-senders";
import { getInvoices } from "@/lib/db/queries";
import { ErstabrufClient } from "./erstabruf-client";

export const dynamic = "force-dynamic";

export default async function ErstabrufPage() {
  const auth = await getCurrentAuth();
  if (!auth) redirect("/login");

  const orgId = auth.organization?.id ?? null;
  // Senders für die Triage + die noch offenen Rechnungen, damit die
  // Anbieter-Klassifizierung im selben Schritt die Rechnungen freigibt
  // (geschäftlich → 'ready') bzw. privat markiert.
  const [senders, reviewInvoices] = await Promise.all([
    listDiscoveredSenders(orgId),
    getInvoices({ organizationId: orgId, status: "needs_review" }),
  ]);

  const invoicesForReview = reviewInvoices.map((i) => ({ id: i.id, vendorDomain: i.vendorDomain }));

  return <ErstabrufClient senders={senders} reviewInvoices={invoicesForReview} />;
}
