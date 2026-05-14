import { Fragment } from "react";
import Link from "next/link";
import { getMissingItems, type MissingItem } from "@/lib/db/queries";
import { VendorLogo } from "@/components/ui/vendor-logo";
import { MissingRefreshButton } from "./missing-refresh-button";

// ─── Helpers ─────────────────────────────────────────────────────────────────

const MONTHS_DE = [
  "Januar", "Februar", "März", "April", "Mai", "Juni",
  "Juli", "August", "September", "Oktober", "November", "Dezember",
];

function fmtYearMonth(ym: string): string {
  const [y, m] = ym.split("-");
  const idx = parseInt(m, 10) - 1;
  return `${MONTHS_DE[idx] ?? m} ${y}`;
}

function fmtAmount(v: number | null): string {
  if (v == null) return "–";
  return (
    "≈ " +
    v.toLocaleString("de-DE", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) +
    " €"
  );
}

function reasonText(item: MissingItem): string {
  if (item.bucket === "help") {
    if (item.portalStatus === "failed")         return "Letzter Abruf fehlgeschlagen — Login nötig";
    if (item.portalStatus === "login_required") return "Login abgelaufen — bitte neu anmelden";
    return "Brauche kurz dein OK";
  }
  if (item.bucket === "auto") return "Wird automatisch geholt";
  const n = item.missingMonths;
  return n > 1 ? `${n} Monate fehlen` : "Noch nicht eingegangen";
}

function groupByYearMonth(items: MissingItem[]): Array<{
  ym: string;
  label: string;
  items: MissingItem[];
  expectedSum: number;
}> {
  const map = new Map<string, MissingItem[]>();
  for (const item of items) {
    const existing = map.get(item.yearMonth);
    if (existing) existing.push(item);
    else map.set(item.yearMonth, [item]);
  }
  // Sort descending (newest month first)
  const sorted = Array.from(map.entries()).sort(([a], [b]) => b.localeCompare(a));
  return sorted.map(([ym, rows]) => ({
    ym,
    label: fmtYearMonth(ym),
    items: rows,
    expectedSum: rows.reduce((acc, r) => acc + (r.avgAmount ?? 0), 0),
  }));
}

// ─── Row actions — per bucket ─────────────────────────────────────────────────

function RowActions({ item }: { item: MissingItem }) {
  void item;
  return (
    <div className="flex shrink-0 items-center gap-3">
      <Link
        href="/audit"
        className="whitespace-nowrap text-xs text-muted underline decoration-line underline-offset-4 opacity-0 transition-opacity hover:text-ink group-hover/row:opacity-100"
      >
        manuell hinzufügen
      </Link>
    </div>
  );
}

// ─── Main component ───────────────────────────────────────────────────────────

export function MissingListView() {
  const items = getMissingItems();

  if (items.length === 0) {
    return (
      <div className="py-12 text-center">
        <div className="text-sm font-medium text-ink">Alles drin.</div>
        <p className="mt-1 text-sm text-muted">
          Wir haben keine Lücken bei deinen Lieferanten gefunden.
        </p>
        <div className="mt-6 flex justify-center">
          <MissingRefreshButton />
        </div>
      </div>
    );
  }

  const groups = groupByYearMonth(items);

  return (
    <div>
      {groups.map(({ ym, label, items: rows, expectedSum }) => (
        <Fragment key={ym}>
          {/* Month header — matches pattern from other inbox tabs */}
          <div className="flex items-baseline justify-between border-b border-line pb-3 pt-8">
            <div className="font-display text-3xl leading-none text-ink">{label}</div>
            <div className="text-xs text-muted">
              {rows.length} {rows.length === 1 ? "Rechnung" : "Rechnungen"} erwartet
              {expectedSum > 0 && (
                <>
                  {" · "}
                  <span className="stat-num text-ink">
                    {expectedSum.toLocaleString("de-DE", {
                      style: "currency",
                      currency: "EUR",
                      minimumFractionDigits: 0,
                      maximumFractionDigits: 0,
                    })}
                  </span>
                </>
              )}
            </div>
          </div>
          <ul>
            {rows.map((item) => (
              <li
                key={`${item.vendorId}-${item.yearMonth}`}
                className="group/row flex items-center gap-4 border-b border-line py-5"
              >
                <VendorLogo
                  domain={item.vendorDomain}
                  name={item.vendorName}
                  size={40}
                />

                <div className="min-w-0 flex-1">
                  <div className="text-sm font-medium text-ink">{item.vendorName}</div>
                  <div className="mt-0.5 text-xs text-muted">{reasonText(item)}</div>
                </div>

                <div className="hidden shrink-0 text-right sm:block">
                  <div className="stat-num whitespace-nowrap text-sm text-ink">
                    {fmtAmount(item.avgAmount)}
                  </div>
                </div>

                <RowActions item={item} />
              </li>
            ))}
          </ul>
        </Fragment>
      ))}

      <div className="flex items-center justify-between py-3">
        <p className="text-xs text-muted">
          Erwartungen kommen aus den letzten 12 Monaten.
        </p>
        <MissingRefreshButton />
      </div>
    </div>
  );
}
