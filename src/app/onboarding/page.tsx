import { getCurrentAuth } from "@/lib/auth/current";
import { getDb } from "@/lib/db/client";
import { ensureInboundAddressForOrg } from "@/mail/inbound-addresses";
import { OnboardingWizard } from "@/components/onboarding/onboarding-wizard";

export const dynamic = "force-dynamic";

export default async function OnboardingPage() {
  const auth = await getCurrentAuth();
  const db = getDb();

  const inboundAddress = auth?.organization
    ? ensureInboundAddressForOrg(auth.organization.id, db).fullAddress
    : null;

  return <OnboardingWizard inboundAddress={inboundAddress} />;
}
