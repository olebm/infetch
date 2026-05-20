import { redirect } from "next/navigation";
import { AppShell } from "@/components/layout/app-shell";
import { UpgradeProvider } from "@/components/providers/upgrade-provider";
import { UpgradeModal } from "@/components/ui/upgrade-modal";
import { SupportProvider } from "@/components/support/support-provider";
import { SupportModal } from "@/components/support/support-modal";
import { SupportFab } from "@/components/support/support-fab";
import { getCurrentAuth } from "@/lib/auth/current";
import { isStripeConfigured } from "@/lib/stripe";
import { getPrimaryMailAccount, getSetupSnapshot } from "@/lib/db/queries";
import { MailInvalidBanner } from "@/components/status/mail-invalid-banner";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const auth = await getCurrentAuth();
  const userEmail = auth?.user?.email ?? undefined;

  // Hard-Gate auf vollständiges Setup: ohne IMAP+SMTP+Export-Ziel würde der
  // User mit "Einrichtung nicht abgeschlossen"-Banner auf dem Dashboard
  // landen — besser zurück in den Wizard.
  const orgId = auth?.organization?.id;
  if (!orgId) {
    redirect("/onboarding");
  }
  const setup = await getSetupSnapshot(orgId);
  if (!setup.imapConfigured || !setup.smtpConfigured || !setup.exportTargetActive) {
    redirect("/onboarding");
  }
  const mailAccount = await getPrimaryMailAccount(orgId);

  return (
    <UpgradeProvider stripeConfigured={isStripeConfigured()}>
      <SupportProvider>
        {mailAccount?.status === "invalid" && <MailInvalidBanner />}
        <AppShell>{children}</AppShell>
        <UpgradeModal />
        <SupportModal userEmail={userEmail} />
        <SupportFab />
      </SupportProvider>
    </UpgradeProvider>
  );
}
