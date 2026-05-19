import { Crown } from "lucide-react";
import { getLimits, type Tier } from "@/lib/tier";
import { isStripeConfigured } from "@/lib/stripe";
import { appConfig } from "@/lib/config/env";

type Props = {
  tier: Tier;
  current: number;
  max: number;
};

export function UpgradeCard({ tier, current, max }: Props) {
  if (!appConfig.billing.proEnabled) return null; // Free-only Launch
  if (tier !== "free") return null;
  if (!Number.isFinite(max)) return null;

  const proLimits = getLimits("pro");
  const stripeConfigured = isStripeConfigured();
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
            Pro hebt das Limit auf — unbegrenzte Online-Konten, Prioritäts-Support,{" "}
            {proLimits.priceMonthlyEur} € / Monat.
          </p>
          {stripeConfigured ? (
            <form action="/api/stripe/checkout" method="post">
              <button
                type="submit"
                className="mt-2 inline-flex items-center gap-1.5 rounded bg-warn px-3 py-1.5 text-xs font-medium text-white hover:bg-warn/90"
              >
                Auf Pro upgraden
              </button>
            </form>
          ) : (
            <a
              href="mailto:hallo@infetch.de?subject=Pro-Plan"
              className="mt-2 inline-flex items-center gap-1.5 rounded bg-warn px-3 py-1.5 text-xs font-medium text-white hover:bg-warn/90"
            >
              Pro anfragen
            </a>
          )}
        </div>
      </div>
    </div>
  );
}
