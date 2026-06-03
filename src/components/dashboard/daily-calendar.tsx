"use client";

import { useEffect, useMemo, useState } from "react";

interface DailyCalendarProps {
  /** Array of `{date: "YYYY-MM-DD", count: number}`. Pass at least 30 days. */
  data: Array<{ date: string; count: number }>;
}

const WEEKDAYS = ["S", "M", "D", "M", "D", "F", "S"] as const;

function fmtShort(d: Date) {
  return `${d.getDate()}.${d.getMonth() + 1}.`;
}

/**
 * Daily activity bar chart — pixel-matches Claude Design's `DailyCalendar`.
 *
 * Range toggles (7 / 30 / 90 days, underlined), live total in the header,
 * gradient bars (today = ink, weekend = ink/15, weekday = ink/55), hover
 * tooltip with date + count, x-axis ticks at meaningful intervals.
 *
 * Bars animate in via height transition on mount.
 */
export function DailyCalendar({ data }: DailyCalendarProps) {
  const [range, setRange] = useState<7 | 30 | 90>(30);
  const [hovered, setHovered] = useState<number | null>(null);
  const [mounted, setMounted] = useState(false);

  // Pick last `range` days from data, pad with zeros if needed
  const days = useMemo(() => {
    const today = new Date();
    today.setHours(12, 0, 0, 0);
    const out: Array<{ date: Date; count: number; isToday: boolean; isWeekend: boolean }> = [];
    for (let i = range - 1; i >= 0; i--) {
      const d = new Date(today);
      d.setDate(today.getDate() - i);
      const iso = d.toISOString().slice(0, 10);
      const match = data.find((x) => x.date === iso);
      const dow = d.getDay();
      out.push({
        date: d,
        count: match?.count ?? 0,
        isToday: i === 0,
        isWeekend: dow === 0 || dow === 6,
      });
    }
    return out;
  }, [data, range]);

  const max = Math.max(...days.map((d) => d.count), 1);
  const total = days.reduce((s, d) => s + d.count, 0);

  // Reset mount-animation when range changes.
  // setMounted(false) is called during render via the "store previous value"
  // pattern (https://react.dev/reference/react/useState#storing-information-from-previous-renders),
  // while the setTimeout(setMounted(true)) stays in an effect.
  const [prevRange, setPrevRange] = useState(range);
  if (prevRange !== range) {
    setPrevRange(range);
    setMounted(false);
  }
  useEffect(() => {
    const t = setTimeout(() => setMounted(true), 30);
    return () => clearTimeout(t);
  }, [range]);

  // Tick indices — meaningful breakpoints per range
  const tickIdx = useMemo(() => {
    if (range === 7) return [0, 1, 2, 3, 4, 5, 6];
    if (range === 30) return [0, 7, 14, 21, 29];
    return [0, 22, 44, 66, 89];
  }, [range]);

  const gap = range === 7 ? 16 : range === 30 ? 4 : 2;

  return (
    <div className="w-full">
      {/* Header row */}
      <div className="mb-5 flex items-baseline justify-between text-xs">
        <div className="text-muted">
          <span className="stat-num text-ink">{total}</span> Rechnungen · letzte {range} Tage
        </div>
        <div className="inline-flex gap-3">
          {([7, 30, 90] as const).map((r) => (
            <button
              key={r}
              type="button"
              onClick={() => setRange(r)}
              className={`transition-colors ${
                range === r
                  ? "text-ink underline decoration-1 underline-offset-[6px]"
                  : "text-muted hover:text-ink"
              }`}
            >
              {r} T
            </button>
          ))}
        </div>
      </div>

      {/* Bars */}
      <div className="relative">
        <div className="pointer-events-none absolute inset-0 flex flex-col justify-between">
          <div className="border-t border-line/40" />
          <div className="border-t border-line" />
        </div>

        <div className="relative flex h-[120px] items-end" style={{ gap }}>
          {days.map((d, i) => {
            const h = mounted ? (d.count / max) * 100 : 0;
            const isHover = hovered === i;
            return (
              <button
                key={i}
                type="button"
                onMouseEnter={() => setHovered(i)}
                onMouseLeave={() => setHovered(null)}
                className="group relative flex h-full flex-1 cursor-pointer flex-col items-stretch justify-end"
                aria-label={`${fmtShort(d.date)}: ${d.count} Rechnungen`}
              >
                <div
                  className={`transition-[height,background-color] duration-500 ease-out ${
                    isHover || d.isToday
                      ? "bg-ink"
                      : d.isWeekend
                        ? "bg-ink/15"
                        : "bg-ink/55 group-hover:bg-ink/85"
                  }`}
                  style={{
                    height: `${Math.max(1.5, h)}%`,
                    transitionDelay: mounted ? `${i * 6}ms` : "0ms",
                  }}
                />
                {isHover && (
                  <div className="pointer-events-none absolute bottom-full left-1/2 z-10 mb-2 -translate-x-1/2 whitespace-nowrap rounded-md border border-line bg-paper px-2.5 py-1.5 text-[11px] text-ink shadow-soft">
                    <div className="stat-num text-[10px] text-muted">
                      {fmtShort(d.date)}
                      {d.isToday && " · heute"}
                    </div>
                    <div className="mt-0.5 stat-num">{d.count} Rechnungen</div>
                  </div>
                )}
              </button>
            );
          })}
        </div>

        {/* X-axis labels */}
        <div className="mt-2 flex h-4 items-center text-[10px] text-muted" style={{ gap }}>
          {days.map((d, i) => (
            <div key={i} className="flex-1 whitespace-nowrap text-center stat-num leading-none">
              {d.isToday ? (
                <span className="text-ink">heute</span>
              ) : tickIdx.includes(i) ? (
                range === 7 ? (
                  WEEKDAYS[d.date.getDay()]
                ) : (
                  fmtShort(d.date)
                )
              ) : (
                ""
              )}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
