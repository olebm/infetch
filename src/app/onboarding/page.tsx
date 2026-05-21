import { redirect } from "next/navigation";
import { requireCurrentAuth } from "@/lib/auth/current";
import { getSetupSnapshot } from "@/lib/db/queries";
import { OnboardingWizard } from "@/components/onboarding/onboarding-wizard";

export const dynamic = "force-dynamic";

type SearchParams = { mode?: string };

export default async function OnboardingPage(
  { searchParams }: { searchParams: Promise<SearchParams> },
) {
  const auth = await requireCurrentAuth();
  const orgId = auth.organization?.id;
  const params = await searchParams;
  const editMode = params.mode === "edit";

  if (orgId && !editMode) {
    // Setup vollstaendig + kein Edit-Mode → direkt aufs Dashboard.
    // Spiegelt das Hard-Gate im (app)/layout.tsx und vermeidet
    // Redirect-Loops. Bei `?mode=edit` darf der User auch mit
    // vollstaendigem Setup zurueck zum Wizard (Postfach wechseln).
    const setup = await getSetupSnapshot(orgId);
    if (setup.imapConfigured && setup.smtpConfigured && setup.exportTargetActive) {
      redirect("/");
    }
  }
  // userId an den Wizard durchreichen, damit sein sessionStorage-Key user-
  // scoped ist. Sonst sieht ein User, der sich nach Konto-Löschung mit
  // gleicher Mail neu anmeldet, die Wizard-Eingaben des Vorgängers — die
  // neue userId garantiert einen frischen Storage-Slot.
  return <OnboardingWizard userId={auth.user.id} editMode={editMode} />;
}
