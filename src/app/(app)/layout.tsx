import { redirect } from "next/navigation";
import { AppShell } from "@/components/layout/app-shell";
import { UpgradeProvider } from "@/components/providers/upgrade-provider";
import { UpgradeModal } from "@/components/ui/upgrade-modal";
import { SupportProvider } from "@/components/support/support-provider";
import { SupportModal } from "@/components/support/support-modal";
import { SupportFab } from "@/components/support/support-fab";
import { getCurrentAuth } from "@/lib/auth/current";
import { isStripeConfigured } from "@/lib/stripe";
import { getPrimaryMailAccount } from "@/lib/db/queries";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const auth = await getCurrentAuth();
  const userEmail = auth?.user?.email ?? undefined;

  // Kein Mail-Account → Onboarding noch nicht abgeschlossen.
  // Scoped auf die Organisation des eingeloggten Users; proxy.ts stellt sicher
  // dass wir hier nur mit authentifizierten Requests landen.
  const orgId = auth?.organization?.id;
  if (!orgId) {
    redirect("/onboarding");
  }
  const mailAccount = await getPrimaryMailAccount(orgId);
  if (!mailAccount) {
    redirect("/onboarding");
  }

  return (
    <UpgradeProvider stripeConfigured={isStripeConfigured()}>
      <SupportProvider>
        <AppShell>{children}</AppShell>
        <UpgradeModal />
        <SupportModal userEmail={userEmail} />
        <SupportFab />
      </SupportProvider>
    </UpgradeProvider>
  );
}
