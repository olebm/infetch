"use client";

import { useState } from "react";
import { Copy, Check } from "lucide-react";
import { StatusBadge } from "@/components/status/status-badge";

type Props = {
  address: string;
  receivedCount: number;
  lastReceivedAt: string | null;
};

function formatRelative(value: string | null): string {
  if (!value) return "noch nicht";
  const ts = new Date(value.includes("T") ? value : value.replace(" ", "T") + "Z");
  if (Number.isNaN(ts.getTime())) return value;
  const diffSec = Math.round((Date.now() - ts.getTime()) / 1000);
  if (diffSec < 60) return "gerade eben";
  const diffMin = Math.round(diffSec / 60);
  if (diffMin < 60) return `vor ${diffMin} Min`;
  const diffH = Math.round(diffMin / 60);
  if (diffH < 24) return `vor ${diffH} Std`;
  const diffD = Math.round(diffH / 24);
  if (diffD < 31) return `vor ${diffD} Tagen`;
  return ts.toLocaleDateString("de-DE", { dateStyle: "short" });
}

export function InboundAddressCard({ address, receivedCount, lastReceivedAt }: Props) {
  const [copied, setCopied] = useState(false);

  async function handleCopy() {
    try {
      await navigator.clipboard.writeText(address);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch {
      // clipboard blocked — no feedback
    }
  }

  return (
    <div className="rounded-md border border-line bg-paper p-5">
      {/* Header row */}
      <div className="flex items-start justify-between gap-4 mb-4">
        <div>
          <div className="text-sm font-medium text-ink">Inbound-Adresse</div>
          <div className="text-xs text-muted">Leite Rechnungen hierher — wir nehmen sie ab.</div>
        </div>
        <StatusBadge status="configured" label="aktiv" />
      </div>

      {/* Copy field */}
      <div className="flex items-stretch gap-2">
        <code className="flex-1 select-all rounded border border-line bg-surface px-3 py-2 font-mono text-sm break-all">
          {address}
        </code>
        <button
          type="button"
          onClick={handleCopy}
          className="inline-flex shrink-0 items-center gap-1.5 rounded border border-line bg-paper px-3 py-2 text-xs font-medium hover:bg-surface transition-colors"
          aria-label="Adresse kopieren"
        >
          {copied ? (
            <><Check className="h-3.5 w-3.5 text-ok" aria-hidden />kopiert</>
          ) : (
            <><Copy className="h-3.5 w-3.5" aria-hidden />kopieren</>
          )}
        </button>
      </div>

      {/* Stats grid */}
      <div className="mt-3 grid grid-cols-1 md:grid-cols-3 gap-3 text-xs">
        <div className="rounded border border-line p-3">
          <div className="text-muted">empfangen · 30 Tage</div>
          <div className="text-ink text-base font-semibold stat-num">{receivedCount}</div>
        </div>
        <div className="rounded border border-line p-3">
          <div className="text-muted">kein Scan nötig</div>
          <div className="text-ink text-base font-semibold">Weiterleitung</div>
        </div>
        <div className="rounded border border-line p-3">
          <div className="text-muted">zuletzt empfangen</div>
          <div className="text-ink text-base font-semibold">{formatRelative(lastReceivedAt)}</div>
        </div>
      </div>
    </div>
  );
}
