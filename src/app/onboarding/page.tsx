import { redirect } from "next/navigation";
import { requireCurrentAuth } from "@/lib/auth/current";
import { getSetupSnapshot } from "@/lib/db/queries";
import { OnboardingWizard } from "@/components/onboarding/onboarding-wizard";

export const dynamic = "force-dynamic";

export default async function OnboardingPage() {
  const auth = await requireCurrentAuth();
  const orgId = auth.organization?.id;
  if (orgId) {
    // Setup vollständig → direkt aufs Dashboard. Spiegelt das Hard-Gate
    // im (app)/layout.tsx und vermeidet Redirect-Loops.
    const setup = await getSetupSnapshot(orgId);
    if (setup.imapConfigured && setup.smtpConfigured && setup.exportTargetActive) {
      redirect("/");
    }
  }
  return <OnboardingWizard />;
}
