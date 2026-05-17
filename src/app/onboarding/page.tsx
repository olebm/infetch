import { requireCurrentAuth } from "@/lib/auth/current";
import { OnboardingWizard } from "@/components/onboarding/onboarding-wizard";

export const dynamic = "force-dynamic";

export default async function OnboardingPage() {
  await requireCurrentAuth();
  return <OnboardingWizard />;
}
