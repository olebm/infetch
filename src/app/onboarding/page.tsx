import { redirect } from "next/navigation";
import { requireCurrentAuth } from "@/lib/auth/current";
import { getPrimaryMailAccount } from "@/lib/db/queries";
import { OnboardingWizard } from "@/components/onboarding/onboarding-wizard";

export const dynamic = "force-dynamic";

export default async function OnboardingPage() {
  const auth = await requireCurrentAuth();
  const orgId = auth.organization?.id;
  if (orgId) {
    const mailAccount = await getPrimaryMailAccount(orgId);
    if (mailAccount) redirect("/");
  }
  return <OnboardingWizard />;
}
