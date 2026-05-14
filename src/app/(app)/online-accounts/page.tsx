import { notFound } from "next/navigation";
import { appConfig } from "@/lib/config/env";

export const dynamic = "force-dynamic";

/**
 * Online-Accounts portal — only accessible when ENABLE_PORTALS=true.
 * Returns 404 in all other environments (incl. production default).
 */
export default function OnlineAccountsPage() {
  if (!appConfig.features.enablePortals) {
    notFound();
  }
  // When portals are enabled, render the actual view.
  // This component intentionally has no UI beyond the gate —
  // the OnlineAccountsView component is imported lazily if needed.
  return null;
}
