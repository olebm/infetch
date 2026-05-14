import { getCurrentAuth } from "@/lib/auth/current";
import { ensureInboundAddressForOrg } from "@/mail/inbound-addresses";
import { OnboardingWizard } from "@/components/onboarding/onboarding-wizard";

export const dynamic = "force-dynamic";

export default async function OnboardingPage() {
  const auth = await getCurrentAuth();

  const inboundAddress = auth?.organization
    ? (await ensureInboundAddressForOrg(auth.organization.id)).fullAddress
    : null;

  return <OnboardingWizard inboundAddress={inboundAddress} />;
}
