"use client";

import { Zap, Check } from "lucide-react";
import { useUpgrade } from "@/components/providers/upgrade-provider";
import { Card } from "@/components/ui/card";
import type { Tier, TierLimits } from "@/lib/tier";

const PLAN_FEATURES: Record<Tier, string[]> = {
  free: [
    "30 Rechnungen / Monat",
    "1 Postfach (IMAP)",
    "500 MB Speicher",
    "Auto-Approve",
  ],
  pro: [
    "150 Rechnungen / Monat",
    "3 Postfächer (IMAP)",
    "2 GB Speicher",
    "Export zu Lexoffice & sevDesk",
    "Retroaktiver IMAP-Scan",
    "Bulk-Download",
    "Bis zu 3 Nutzer",
  ],
  business: [
    "Unbegrenzte Rechnungen",
    "Unbegrenzte Postfächer",
    "50 GB Speicher",
    "Alle Pro-Features",
    "Portal-Agent (Beta)",
    "Datev-Export",
    "Unbegrenzte Nutzer",
  ],
};

type Props = {
  tier: Tier;
  limits: TierLimits;
};

export function BillingCard({ tier, limits }: Props) {
  const { openModal } = useUpgrade();
  const isFree = tier === "free";
  const features = PLAN_FEATURES[tier];

  return (
    <Card padding="none">
      <div className="flex items-start justify-between gap-4 p-5">
        <div>
          <div className="text-sm font-medium text-ink">Abrechnung</div>
          <div className="text-xs text-muted">
            {isFree ? "Kostenlos — kein Kreditkarte erforderlich." : `${limits.priceMonthlyEur} € / Monat · jederzeit kündbar.`}
          </div>
        </div>

        <div className="flex items-center gap-2 shrink-0">
          <span
            className={`inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-medium ${
              isFree
                ? "bg-surface text-muted border border-line"
                : "bg-brand/10 text-brand border border-brand/20"
            }`}
          >
            {isFree ? null : <Zap size={10} aria-hidden />}
            {limits.label}
          </span>

          {isFree && (
            <button
              type="button"
              onClick={() => openModal("Plan upgraden")}
              className="inline-flex items-center gap-1.5 rounded-md bg-brand px-3 py-1.5 text-xs font-medium text-white shadow-soft hover:bg-brand/90 transition-colors"
            >
              <Zap size={11} aria-hidden />
              Upgrade
            </button>
          )}
        </div>
      </div>

      {/* Feature list */}
      <ul className="border-t border-line divide-y divide-line">
        {features.map((f) => (
          <li key={f} className="flex items-center gap-2.5 px-5 py-2.5">
            <Check size={13} className="shrink-0 text-ok" aria-hidden />
            <span className="text-sm text-ink">{f}</span>
          </li>
        ))}
      </ul>

      {/* Free → Pro nudge */}
      {isFree && (
        <div className="border-t border-line bg-brand/[0.03] px-5 py-4">
          <div className="text-xs text-muted">
            Mit{" "}
            <button
              type="button"
              onClick={() => openModal("Pro-Plan")}
              className="font-medium text-brand underline decoration-brand/30 underline-offset-2 hover:decoration-brand"
            >
              Pro
            </button>{" "}
            bekommst du Exporte, retroaktiven Scan und bis zu 3 Nutzer — ab 19 €/Monat.
          </div>
        </div>
      )}
    </Card>
  );
}
