import { notFound } from "next/navigation";
import { appConfig } from "@/lib/config/env";
import { OnlineAccountsView } from "@/components/online-accounts/online-accounts-view";

export const dynamic = "force-dynamic";

/**
 * Online-Accounts portal — only accessible when ENABLE_PORTALS=true (globaler
 * Not-Aus → 404). Das Tier-Gating passiert in der View: Free sieht die
 * UpgradeCard, Pro/Business die volle Verwaltung.
 */
export default function OnlineAccountsPage() {
  if (!appConfig.features.enablePortals) {
    notFound();
  }
  return <OnlineAccountsView />;
}
