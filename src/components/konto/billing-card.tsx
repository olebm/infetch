"use client";

import { useState } from "react";
import { Zap, Check, Loader2, ExternalLink } from "lucide-react";
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
    "20 GB Speicher",
    "Alle Pro-Features",
    "Portal-Agent (Beta)",
    "Datev-Export",
    "Unbegrenzte Nutzer",
  ],
};

type Props = {
  tier: Tier;
  limits: TierLimits;
  /** true wenn stripe_customer_id vorhanden (Portal-Link zeigen) */
  hasStripeCustomer?: boolean;
};

export function BillingCard({ tier, limits, hasStripeCustomer = false }: Props) {
  const { openModal, proEnabled } = useUpgrade();
  const isFree = tier === "free";
  const isPaidTier = !isFree;
  const features = PLAN_FEATURES[tier];
  const [portalLoading, setPortalLoading] = useState(false);
  const [portalError, setPortalError] = useState<string | null>(null);

  async function handlePortal() {
    setPortalLoading(true);
    setPortalError(null);
    try {
      const res = await fetch("/api/stripe/portal-session", { method: "POST" });
      if (res.redirected) {
        window.location.href = res.url;
        return;
      }
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error ?? "Unbekannter Fehler");
      }
    } catch (err) {
      setPortalError(err instanceof Error ? err.message : "Fehler beim Öffnen des Portals.");
      setPortalLoading(false);
    }
  }

  return (
    <Card padding="none">
      <div className="flex items-start justify-between gap-4 p-5">
        <div>
          <div className="text-sm font-medium text-ink">Paket</div>
          <div className="text-xs text-muted">
            {isFree
              ? "Kostenlos — keine Kreditkarte erforderlich."
              : `${limits.priceMonthlyEur} € / Monat · jederzeit kündbar.`}
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

          {isFree && proEnabled && (
            <button
              type="button"
              onClick={() => openModal("Plan upgraden")}
              className="inline-flex items-center gap-1.5 rounded-md bg-brand px-3 py-1.5 text-xs font-medium text-white shadow-soft hover:bg-brand/90 transition-colors"
            >
              <Zap size={11} aria-hidden />
              Upgrade
            </button>
          )}

          {isPaidTier && hasStripeCustomer && (
            <button
              type="button"
              onClick={handlePortal}
              disabled={portalLoading}
              className="inline-flex items-center gap-1.5 rounded-md border border-line bg-white px-3 py-1.5 text-xs font-medium text-ink shadow-soft hover:bg-surface transition-colors disabled:opacity-60"
            >
              {portalLoading ? (
                <Loader2 size={11} className="animate-spin" aria-hidden />
              ) : (
                <ExternalLink size={11} aria-hidden />
              )}
              Abonnement verwalten
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

      {portalError && (
        <div className="border-t border-line px-5 py-3 text-xs text-danger">
          {portalError}
        </div>
      )}

      {/* Free → Pro nudge */}
      {isFree && proEnabled && (
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
