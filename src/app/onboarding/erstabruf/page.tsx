import { redirect } from "next/navigation";
import { getCurrentAuth } from "@/lib/auth/current";
import { listDiscoveredSenders } from "@/senders/discovered-senders";
import { ErstabrufClient } from "./erstabruf-client";

export const dynamic = "force-dynamic";

export default async function ErstabrufPage() {
  const auth = await getCurrentAuth();
  if (!auth) redirect("/login");

  // Nur die Senders für die Triage. Die Rechnungs-Freigabe macht der
  // finish-Handler server-seitig auf den LIVE needs_review-Rechnungen
  // (finishOnboardingTriageAction) — kein Snapshot-Problem beim async-Scan.
  const senders = await listDiscoveredSenders(auth.organization?.id ?? null);

  return <ErstabrufClient senders={senders} />;
}
