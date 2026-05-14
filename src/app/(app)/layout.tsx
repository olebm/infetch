import { AppShell } from "@/components/layout/app-shell";
import { UpgradeProvider } from "@/components/providers/upgrade-provider";
import { UpgradeModal } from "@/components/ui/upgrade-modal";
import { SupportProvider } from "@/components/support/support-provider";
import { SupportModal } from "@/components/support/support-modal";
import { SupportFab } from "@/components/support/support-fab";
import { getCurrentAuth } from "@/lib/auth/current";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const stripeLink = process.env.STRIPE_PAYMENT_LINK_PRO ?? null;
  const auth = await getCurrentAuth();
  const userEmail = auth?.user?.email ?? undefined;

  return (
    <UpgradeProvider stripeLink={stripeLink}>
      <SupportProvider>
        <AppShell>{children}</AppShell>
        <UpgradeModal />
        <SupportModal userEmail={userEmail} />
        <SupportFab />
      </SupportProvider>
    </UpgradeProvider>
  );
}
