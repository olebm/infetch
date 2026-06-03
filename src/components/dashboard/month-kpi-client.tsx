"use client";

import { useState, useEffect } from "react";

export type OlderMonth = { label: string; count: number };

type MonthKpiClientProps = {
  total: number;
  deltaPercent: number | null;
  prevTotal: number;
  prevMonthLabel: string;
  olderMonths: OlderMonth[];
};

/**
 * Client wrapper for the "Monat in Review" left column.
 *
 * Handles:
 *  - CountUp animation on the big number (eased, 700 ms)
 *  - Compare toggle: click delta-badge to expand older months
 */
export function MonthKpiClient({
  total,
  deltaPercent,
  prevTotal,
  prevMonthLabel,
  olderMonths,
}: MonthKpiClientProps) {
  const [compareOpen, setCompareOpen] = useState(false);
  const [displayValue, setDisplayValue] = useState(0);

  // Animate on mount (or when total changes)
  useEffect(() => {
    if (total === 0) return;
    const duration = 700;
    let raf: number;
    let start: number | undefined;
    const tick = (t: number) => {
      if (start === undefined) start = t;
      const p = Math.min(1, (t - start) / duration);
      const eased = 1 - Math.pow(1 - p, 3); // ease-out cubic
      setDisplayValue(Math.round(eased * total));
      if (p < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [total]);

  const hasDelta = deltaPercent !== null && deltaPercent !== 0;
  const hasOlderMonths = olderMonths.length > 0;

  return (
    <div>
      {/* Big number + delta button */}
      <div className="flex flex-wrap items-end gap-5">
        <div className="font-display text-[clamp(56px,8vw,112px)] leading-[0.9] tracking-[-0.04em] text-ink stat-num">
          {displayValue.toLocaleString("de-DE")}
        </div>

        {hasDelta && (
          <button
            type="button"
            onClick={() => hasOlderMonths && setCompareOpen((o) => !o)}
            title="Vergleich Vormonat ein-/ausblenden"
            className="mb-3 text-left group"
            aria-expanded={compareOpen}
          >
            <div className="flex items-baseline gap-1.5 stat-num font-display text-2xl leading-none text-ink">
              <span className="text-ink/70">{(deltaPercent ?? 0) >= 0 ? "↗" : "↘"}</span>
              <span>
                {(deltaPercent ?? 0) >= 0 ? "+" : ""}
                {deltaPercent}&nbsp;%
              </span>
            </div>
            <div className="mt-1.5 text-[11px] text-muted group-hover:text-ink transition-colors stat-num">
              {prevMonthLabel}&nbsp;·&nbsp;{prevTotal}
              {hasOlderMonths && (
                <>
                  &nbsp;<span className="text-muted/60">{compareOpen ? "▴" : "▾"}</span>
                </>
              )}
            </div>
          </button>
        )}
      </div>

      {/* Static label */}
      <div className="mt-4 max-w-xs font-display text-xl leading-tight text-ink">
        Rechnungen <em>automatisch</em> versendet.
      </div>

      {/* Older months — shown when compare is open */}
      {compareOpen && hasOlderMonths && (
        <div className="mt-4 flex flex-wrap items-center gap-4 text-xs text-muted stat-num">
          {olderMonths.map((m) => (
            <span key={m.label}>
              {m.label}&nbsp;·&nbsp;{m.count}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}
