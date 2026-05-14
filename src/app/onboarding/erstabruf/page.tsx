import { redirect } from "next/navigation";
import { getCurrentAuth } from "@/lib/auth/current";
import { getDb } from "@/lib/db/client";
import { listDiscoveredSenders } from "@/senders/discovered-senders";
import { ErstabrufClient } from "./erstabruf-client";

export const dynamic = "force-dynamic";

export default async function ErstabrufPage() {
  const auth = await getCurrentAuth();
  if (!auth) redirect("/login");

  const db = getDb();
  const senders = listDiscoveredSenders(db);

  return <ErstabrufClient senders={senders} />;
}
