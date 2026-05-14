import { redirect } from "next/navigation";
import { getCurrentAuth } from "@/lib/auth/current";
import { listDiscoveredSenders } from "@/senders/discovered-senders";
import { ErstabrufClient } from "./erstabruf-client";

export const dynamic = "force-dynamic";

export default async function ErstabrufPage() {
  const auth = await getCurrentAuth();
  if (!auth) redirect("/login");

  const senders = await listDiscoveredSenders();

  return <ErstabrufClient senders={senders} />;
}
