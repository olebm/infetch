import { Crown } from "lucide-react";
import { getLimits, type Tier } from "@/lib/tier";
import { getCheckoutUrl } from "@/lib/stripe";

type Props = {
  tier: Tier;
  current: number;
  max: number;
};

export function UpgradeCard({ tier, current, max }: Props) {
  if (tier !== "free") return null;
  if (!Number.isFinite(max)) return null;

  const proLimits = getLimits("pro");
  const checkoutUrl = getCheckoutUrl("pro");
  const reached = current >= max;
  const nearLimit = current >= max - 1;

  if (!reached && !nearLimit) return null;

  return (
    <div className="rounded border border-warn/30 bg-warn-soft px-4 py-3">
      <div className="flex items-start gap-3">
        <Crown className="mt-0.5 h-4 w-4 shrink-0 text-warn" aria-hidden />
        <div className="flex-1 text-sm">
          <div className="font-medium text-warn">
            {reached
              ? `Du nutzt ${current} von ${max} Online-Konten (Free-Tier).`
              : `Nur noch ein freier Slot — ${current} von ${max} Online-Konten genutzt.`}
          </div>
          <p className="mt-1 text-xs text-warn">
            Pro hebt das Limit auf — unbegrenzte Online-Konten, Prioritaets-Support,
            {" "}
            {proLimits.priceMonthlyEur} € / Monat.
          </p>
          {checkoutUrl ? (
            <a
              href={checkoutUrl}
              target="_blank"
              rel="noreferrer"
              className="mt-2 inline-flex items-center gap-1.5 rounded bg-warn px-3 py-1.5 text-xs font-medium text-white hover:bg-warn/90"
            >
              Auf Pro upgraden
            </a>
          ) : (
            <p className="mt-2 text-xs text-warn">
              Pro ist derzeit nur direkt bei tools@ole-beekmann.de verfuegbar.
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
