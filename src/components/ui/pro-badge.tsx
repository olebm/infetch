"use client";

import { useUpgrade } from "@/components/providers/upgrade-provider";

type ProBadgeProps = {
  /** Welches Feature wird gelockt — erscheint im Modal als Kontext */
  feature?: string;
  className?: string;
};

/**
 * Dezente "Pro"-Pill. Für Free-User klickbar → öffnet UpgradeModal.
 * Für Pro-User unsichtbar.
 */
export function ProBadge({ feature, className = "" }: ProBadgeProps) {
  const { openModal, proEnabled } = useUpgrade();

  if (!proEnabled) return null; // Free-only Launch: keine Pro-Hinweise

  return (
    <button
      type="button"
      onClick={() => openModal(feature)}
      className={`inline-flex items-center rounded-full bg-brand/10 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-brand hover:bg-brand/20 transition-colors cursor-pointer ${className}`}
      title="Pro-Feature — Upgrade für Zugriff"
    >
      Pro
    </button>
  );
}
