import { Check, X } from "lucide-react";
import { getOrgTier, getLimits, getMonthlyImportCount, getStorageUsageBytes } from "@/lib/tier";
import { Card } from "@/components/ui/card";

// Pro-Upsell (Paketvergleich + Upgrade-CTA) vorerst ausgeblendet — Code bleibt
// erhalten; auf `true` setzen, um Vergleich + Upgrade-Button wieder zu zeigen.
const SHOW_PLAN_COMPARISON = false;

function formatBytes(bytes: number): string {
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

function formatBytesLimit(bytes: number): string {
  if (bytes >= 1024 * 1024 * 1024) return `${Math.round(bytes / (1024 * 1024 * 1024))} GB`;
  return `${Math.round(bytes / (1024 * 1024))} MB`;
}

type UsageBarProps = {
  label: string;
  current: number;
  max: number;
  formatCurrent: (n: number) => string;
  formatMax: (n: number) => string;
  unit?: string;
};

function UsageBar({ label, current, max, formatCurrent, formatMax, unit }: UsageBarProps) {
  const pct     = Math.min(100, Math.round((current / max) * 100));
  const isWarn  = pct >= 80 && pct < 100;
  const isFull  = pct >= 100;

  const barColor = isFull
    ? "bg-danger"
    : isWarn
    ? "bg-warn"
    : "bg-brand";

  const textColor = isFull
    ? "text-danger"
    : isWarn
    ? "text-warn"
    : "text-muted";

  return (
    <div>
      <div className="mb-1.5 flex items-center justify-between">
        <span className="text-xs font-medium text-ink">{label}</span>
        <span className={`text-xs font-mono ${textColor}`}>
          {formatCurrent(current)}/{formatMax(max)}{unit ? ` ${unit}` : ""}
        </span>
      </div>
      <div className="h-1.5 w-full overflow-hidden rounded-full bg-line">
        <div
          className={`h-full rounded-full transition-all ${barColor}`}
          style={{ width: `${pct}%` }}
        />
      </div>
      {isFull && (
        <p className="mt-1 text-[11px] text-danger">
          Limit erreicht — neue Importe werden blockiert.
        </p>
      )}
      {isWarn && (
        <p className="mt-1 text-[11px] text-warn">
          Fast voll — {100 - pct}% verbleibend.
        </p>
      )}
    </div>
  );
}

type Props = {
  organizationId: string | null | undefined;
  /** @deprecated Wird nicht mehr genutzt — Checkout läuft über /api/stripe/checkout */
  stripePaymentLinkPro?: string | null;
};

export async function UsageCard({ organizationId }: Props) {
  const tier   = await getOrgTier(organizationId);
  const limits = getLimits(tier);

  const [invoiceCount, storageBytes] = await Promise.all([
    getMonthlyImportCount(organizationId),
    getStorageUsageBytes(organizationId),
  ]);

  return (
    <Card padding="lg">
      {/* Header */}
      <div className="mb-4 flex items-center justify-between">
        <div>
          <div className="text-sm font-medium text-ink">Nutzung diesen Monat</div>
          <div className="text-xs text-muted">Paket: {limits.label} · €{limits.priceMonthlyEur}/Monat</div>
        </div>
        {tier !== "free" && (
          <span className="rounded-full bg-brand-soft px-2.5 py-1 text-xs font-medium text-brand-deep">
            {limits.label}
          </span>
        )}
      </div>

      {/* Bars */}
      <div className="space-y-4">
        <UsageBar
          label="Rechnungen"
          current={invoiceCount}
          max={limits.maxInvoicesPerMonth}
          formatCurrent={(n) => String(n)}
          formatMax={(n) => String(n)}
          unit="pro Monat"
        />
        <UsageBar
          label="Speicher"
          current={storageBytes}
          max={limits.maxStorageBytes}
          formatCurrent={formatBytes}
          formatMax={formatBytesLimit}
        />
      </div>

      {/* Plan comparison table */}
      {SHOW_PLAN_COMPARISON && tier === "free" && (
        <div className="mt-6 border-t border-line pt-5">
          <div className="mb-3 text-xs font-medium text-ink">Paketvergleich</div>
          <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr>
                <th className="pb-2 text-left font-medium text-muted w-1/2"></th>
                <th className="pb-2 text-center font-medium text-muted w-1/4">Free</th>
                <th className="pb-2 text-center font-semibold text-brand w-1/4">
                  Pro · €19/Monat
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              <PlanRow label="Rechnungen / Monat" free="30" pro="150" />
              <PlanRow label="Speicher" free="500 MB" pro="2 GB" />
              <PlanRow label="Postfächer (IMAP)" free="1" pro="3" />
              <PlanRow label="Nutzer" free="1" pro="3" />
              <PlanRow label="Auto-Approve" freeOk pro="✓" />
              <PlanRow label="Download: einzeln / pro Anbieter" freeOk pro="✓" />
              <PlanRow label="Download: alle Rechnungen (Bulk)" freeNo proOk />
              <PlanRow label="Retroaktiver Scan (12 Mo.)" freeNo proOk />
              <PlanRow label="Export (lexoffice / sevDesk)" freeNo proOk />
            </tbody>
          </table>
          </div>
          <div className="mt-4">
            <form action="/api/stripe/checkout" method="post">
              <button
                type="submit"
                className="block w-full rounded-md bg-brand py-2 text-center text-xs font-semibold text-white hover:bg-brand/90 transition-colors"
              >
                Upgrade auf Pro
              </button>
            </form>
          </div>
        </div>
      )}
    </Card>
  );
}

type PlanRowProps = {
  label: string;
  free?: string;
  pro?: string;
  freeOk?: boolean;
  freeNo?: boolean;
  proOk?: boolean;
};

function PlanRow({ label, free, pro, freeOk, freeNo, proOk }: PlanRowProps) {
  return (
    <tr>
      <td className="py-2 text-muted">{label}</td>
      <td className="py-2 text-center">
        {freeOk ? (
          <Check className="mx-auto h-3.5 w-3.5 text-ok" />
        ) : freeNo ? (
          <X className="mx-auto h-3.5 w-3.5 text-muted opacity-40" />
        ) : (
          <span className="font-medium text-ink">{free}</span>
        )}
      </td>
      <td className="py-2 text-center">
        {proOk ? (
          <Check className="mx-auto h-3.5 w-3.5 text-brand" />
        ) : (
          <span className="font-semibold text-brand">{pro}</span>
        )}
      </td>
    </tr>
  );
}
