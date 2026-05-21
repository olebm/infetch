import Link from "next/link";
import { AlertTriangle, ChevronRight } from "lucide-react";
import { VendorLogo } from "@/components/ui/vendor-logo";
import { formatVendorName } from "@/lib/vendor-utils";
import { PageHeader } from "@/components/ui/page-header";
import { AutoPilotHero } from "@/components/dashboard/auto-pilot-hero";
import { DailyCalendar } from "@/components/dashboard/daily-calendar";
import { MonthKpiClient, type OlderMonth } from "@/components/dashboard/month-kpi-client";
import {
  getAutomationStats,
  getDailyTimeseries,
  getInvoiceStatusCounts,
  getInvoices,
  getLastScanAt,
  getLastScanFailure,
  getMonthlyKpis,
  getObservationStartDate,
  getOverdueVendors,
  getSecondaryStats,
  getSetupSnapshot,
  getTopVendors,
} from "@/lib/db/queries";
import { getCurrentAuth } from "@/lib/auth/current";
import { getOrgTier, getScanSinceDate, canImportInvoice } from "@/lib/tier";
import { appConfig } from "@/lib/config/env";

const MONTHS_DE = [
  "Januar", "Februar", "März", "April", "Mai", "Juni",
  "Juli", "August", "September", "Oktober", "November", "Dezember",
];

function currencyEUR(amount: number) {
  return amount.toLocaleString("de-DE", {
    style: "currency",
    currency: "EUR",
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  });
}

function formatDate(iso: string | null): string {
  if (!iso) return "—";
  try {
    const d = new Date(iso + "T12:00:00");
    return `${String(d.getDate()).padStart(2, "0")}.${String(d.getMonth() + 1).padStart(2, "0")}.`;
  } catch {
    return iso;
  }
}

function formatAmount(amount: number | null, currency: string | null): string {
  if (amount === null) return "—";
  const value = amount.toLocaleString("de-DE", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const sym = !currency || currency === "EUR" ? "€" : currency;
  return `${value} ${sym}`;
}

/**
 * Dashboard ("Übersicht") — pixel-matches Claude Design.
 *
 * Editorial layout, no boxed sections (only AutoPilotHero has a soft frame).
 * Sections are separated by `mt-16` and section headers carry their own
 * `border-b border-line pb-3` separator with `font-display text-2xl/3xl`.
 *
 * Order:
 *   1. PageHeader (Übersicht + subline)
 *   2. AutoPilotHero (running/fresh/blocked, full-bleed typography)
 *   3. Monat in Review — massive KPI number + DailyCalendar side-by-side
 *   4. Sekundär-Stats (4 cols, font-display)
 *   5. Worauf wir achten (anomaly list, flat rows)
 *   6. Top-Anbieter (5-col grid, logo + name + n × sum + trend)
 *   7. Trust band (<dl> grid, quiet)
 */
export async function DashboardView() {
  const auth = await getCurrentAuth();
  const orgId = auth?.organization?.id ?? null;
  const [
    setup,
    stats,
    secondary,
    daily,
    topVendors,
    overdueVendors,
    duplicates,
    recentInvoicesRaw,
    statusCountsRaw,
    monthly,
    obsStart,
    lastScanAt,
    lastScanFailure,
    tier,
    quota,
  ] = await Promise.all([
    // orgId hier kritisch: ohne ihn würde der Snapshot globale secret_refs
    // prüfen und für jede User-Org "nicht configured" zurückgeben — was den
    // HeroBlocked-Banner ("Postfach und Versand-Adresse fehlen") fälschlich
    // anzeigt, obwohl der Hard-Gate im (app)/layout.tsx den User korrekt
    // durchlässt. Bug nach PR #33 entdeckt.
    getSetupSnapshot(orgId),
    getAutomationStats(orgId),
    getSecondaryStats(orgId),
    getDailyTimeseries(30),
    getTopVendors(5, orgId),
    getOverdueVendors(orgId),
    getInvoices({ status: "duplicate", limit: 3, organizationId: orgId }),
    getInvoices({ limit: 20, organizationId: orgId }),
    getInvoiceStatusCounts(orgId),
    (() => {
      const now = new Date();
      return getMonthlyKpis(now.toISOString().slice(0, 7));
    })(),
    getObservationStartDate(),
    getLastScanAt(),
    getLastScanFailure(),
    getOrgTier(orgId),
    canImportInvoice(orgId),
  ]);

  // Quota-Banner-State: nur fuer Tiers mit endlichem Monatslimit (Free).
  // Pro/Business haben Infinity → kein Banner.
  const quotaMaxFinite = Number.isFinite(quota.max);
  const quotaAtLimit = quotaMaxFinite && quota.current >= quota.max;
  const quotaNearLimit =
    quotaMaxFinite && !quotaAtLimit && quota.current >= Math.floor(quota.max * 0.8);

  // Mehr holen, dann auf 5 mit Vendor-Name filtern → keine „Unbekannter Anbieter"-Einträge
  const recentInvoices = recentInvoicesRaw.filter((inv) => !!inv.vendorName).slice(0, 5);
  const statusCounts = new Map(statusCountsRaw.map((c) => [c.status, Number(c.count)]));
  const reviewCount = ["needs_review", "new", "failed"].reduce(
    (acc, s) => acc + (statusCounts.get(s) ?? 0), 0,
  );

  const now = new Date();
  const monthLabel = `${MONTHS_DE[now.getMonth()]} ${now.getFullYear()}`;
  const monthEnd = new Date(now.getFullYear(), now.getMonth() + 1, 0);
  const monthEndLabel = `${monthEnd.getDate()}. ${MONTHS_DE[now.getMonth()]}`;

  // "seit …" label — erster Scan-Zeitpunkt aus erster Rechnung
  const MONTHS_SHORT = ["Jan","Feb","März","Apr","Mai","Jun","Jul","Aug","Sep","Okt","Nov","Dez"];
  const obsLabel = obsStart
    ? (() => {
        const d = new Date(obsStart);
        return `seit ${d.getDate()}. ${MONTHS_SHORT[d.getMonth()]} ${d.getFullYear()}`;
      })()
    : "seit Beobachtungsbeginn";

  // Previous month label for the compare button
  const prevMonthDate = new Date(now.getFullYear(), now.getMonth() - 1, 1);
  const prevMonthLabel = MONTHS_DE[prevMonthDate.getMonth()];

  // Fetch up to 3 older months (months -2, -3, -4) for compare panel
  const olderMonths: OlderMonth[] = [];
  for (let i = 2; i <= 4; i++) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    const iso = d.toISOString().slice(0, 7);
    const kpi = await getMonthlyKpis(iso);
    if (kpi.total > 0) {
      olderMonths.push({ label: MONTHS_DE[d.getMonth()]!, count: kpi.total });
    }
  }

  // Last scan timestamp for Trust-Band.
  // DashboardView is an async Server Component (runs once per request), so
  // Date.now() is deterministic for the rendered HTML; the react-hooks/purity
  // rule can't distinguish server- from client-components and would otherwise
  // flag this.
  const lastScanLabel = (() => {
    if (!setup.imapConfigured) return "—";
    if (!lastScanAt) return "noch kein Scan";
    // eslint-disable-next-line react-hooks/purity -- server component, single render per request
    const diffMin = Math.round((Date.now() - new Date(lastScanAt).getTime()) / 60_000);
    if (diffMin < 2) return "gerade eben";
    if (diffMin < 60) return `vor ${diffMin} Min`;
    const diffH = Math.round(diffMin / 60);
    if (diffH < 24) return `vor ${diffH} Std`;
    return `vor ${Math.round(diffH / 24)} Tagen`;
  })();

  // Scan-Reichweite (Trust-Band-Subline). Datum kommt aus exakt der Funktion,
  // die der Scanner selbst verwendet — Anzeige und Realitaet matchen damit
  // garantiert. Free = aktueller Monatsbeginn, Pro/Business = syncMonthsBack
  // (Default 6).
  const scanSinceDate = getScanSinceDate(tier, appConfig.syncMonthsBack);
  const scanSinceLabel = `${String(scanSinceDate.getDate()).padStart(2, "0")}.${String(scanSinceDate.getMonth() + 1).padStart(2, "0")}.${scanSinceDate.getFullYear()}`;
  const tierLabel = tier === "free" ? "Free-Plan" : tier === "pro" ? "Pro-Plan" : "Business-Plan";

  // Relativ-Label fuer Banner (analoge Logik, kein Tier-Fallback noetig).
  const lastScanFailureRelative = lastScanFailure
    ? (() => {
        // eslint-disable-next-line react-hooks/purity -- server component
        const diffMin = Math.round((Date.now() - new Date(lastScanFailure.failedAt).getTime()) / 60_000);
        if (diffMin < 2) return "gerade eben";
        if (diffMin < 60) return `vor ${diffMin} Min`;
        const diffH = Math.round(diffMin / 60);
        if (diffH < 24) return `vor ${diffH} Std`;
        return `vor ${Math.round(diffH / 24)} Tagen`;
      })()
    : "";

  // Determine dashboard state for subline
  const isBlocked = !setup.smtpConfigured || !setup.imapConfigured;
  const isFresh = !isBlocked && stats.exportedLifetime === 0;
  const subline = isFresh
    ? "Gleich geht's los — wir warten auf deine erste Rechnung."
    : isBlocked
      ? "Heute braucht eine Sache deine Aufmerksamkeit."
      : "Alles läuft. Du musst hier nichts tun.";

  // Build anomaly list
  const anomalies: Array<{ vendor: string; domain: string | null; reason: string; href: string }> = [];
  for (const v of overdueVendors.slice(0, 2)) {
    const label = formatVendorName(v.vendorName, v.vendorDomain);
    anomalies.push({
      vendor: label,
      domain: v.vendorDomain ?? null,
      reason: `Letzte Rechnung ${v.daysSince} Tage alt — sonst regelmäßig.`,
      href: "/audit?tab=fehlt",
    });
  }
  for (const d of duplicates.slice(0, 1)) {
    anomalies.push({
      vendor: formatVendorName(d.vendorName),
      domain: null,
      reason: "Duplikat erkannt und gefiltert.",
      href: `/audit/${d.id}`,
    });
  }

  return (
    <div className="screen-enter screen-enter-active">
      <PageHeader title="Übersicht" subline={subline} />

      {/* SCAN-FEHLER-BANNER — nur wenn der letzte Scan failed war.
          Verschwindet automatisch, sobald der naechste Scan wieder gruen ist
          (Query liefert null wenn latest sync_run != 'failed'). */}
      {lastScanFailure && setup.imapConfigured && (
        <div className="mt-3 rounded-md border border-warn/30 bg-warn-soft/40 p-4">
          <div className="flex items-start gap-3">
            <AlertTriangle size={18} className="mt-0.5 shrink-0 text-warn" aria-hidden />
            <div className="flex-1">
              <div className="text-sm font-medium text-ink">
                Letzter Scan fehlgeschlagen ({lastScanFailureRelative})
              </div>
              <div className="mt-1 text-xs text-muted">{lastScanFailure.errorSnippet}</div>
              <Link
                href="/einstellungen?tab=postfach"
                className="mt-2 inline-block text-xs text-ink underline underline-offset-4 decoration-line hover:decoration-ink"
              >
                Postfach prüfen →
              </Link>
            </div>
          </div>
        </div>
      )}

      {/* QUOTA-BANNER — nur Free (endliches Limit). Bei 100% bzw. >=80%. */}
      {quotaAtLimit && (
        <div className="mt-3 rounded-md border border-warn/30 bg-warn-soft/40 p-4">
          <div className="flex items-start gap-3">
            <AlertTriangle size={18} className="mt-0.5 shrink-0 text-warn" aria-hidden />
            <div className="flex-1">
              <div className="text-sm font-medium text-ink">
                Monatslimit erreicht (<span className="stat-num">{quota.current}/{quota.max}</span> Rechnungen)
              </div>
              <div className="mt-1 text-xs text-muted">
                Weitere Rechnungen dieses Monats werden im nächsten Monat automatisch nachgeholt — es geht nichts verloren.
              </div>
            </div>
          </div>
        </div>
      )}
      {quotaNearLimit && (
        <div className="mt-3 rounded-md border border-line bg-surface px-4 py-3 text-xs text-muted">
          Du näherst dich dem Monatslimit (
          <span className="stat-num text-ink">{quota.current}/{quota.max}</span> Rechnungen).
        </div>
      )}

      {/* HERO */}
      <AutoPilotHero setup={setup} />

      {/* ── MOBILE DASHBOARD ────────────────────────────────────────────────── */}
      {!isFresh && (
        <div className="md:hidden mt-3">

          {/* Kompakte Monatszeile */}
          <div className="flex items-baseline justify-between border-b border-line pb-3">
            <div className="font-display text-2xl stat-num text-ink">
              {currencyEUR(monthly.total)}
            </div>
            <div className="text-xs text-muted">{monthLabel}</div>
          </div>

          {/* Action Card — nur wenn Rechnungen auf Review warten */}
          {reviewCount > 0 && (
            <Link
              href="/audit?tab=review"
              className="mt-3 flex items-center gap-3 rounded-xl border border-line bg-paper px-4 py-3 border-l-[3px] border-l-brand"
            >
              <span className="h-2 w-2 shrink-0 rounded-full bg-brand" />
              <span className="flex-1 text-sm font-medium text-ink">
                {reviewCount} {reviewCount === 1 ? "Rechnung" : "Rechnungen"} prüfen
              </span>
              <ChevronRight size={16} className="shrink-0 text-brand" aria-hidden />
            </Link>
          )}

          {/* Letzte Eingänge */}
          {recentInvoices.length > 0 && (
            <div className="mt-6">
              <div className="flex items-baseline justify-between border-b border-line pb-3">
                <div className="font-display text-xl text-ink">Letzte Eingänge</div>
                <Link
                  href="/audit"
                  className="text-xs text-muted underline decoration-line underline-offset-4 hover:text-ink"
                >
                  Alle anzeigen
                </Link>
              </div>
              <ul>
                {recentInvoices.map((inv) => (
                  <li key={inv.id}>
                    <Link
                      href={`/audit/${inv.id}`}
                      className="flex items-center gap-3 border-b border-line py-3"
                    >
                      <VendorLogo domain={inv.vendorDomain} name={inv.vendorName} size={32} />
                      <div className="min-w-0 flex-1">
                        <div className="truncate text-sm font-medium text-ink">
                          {inv.vendorName || "Unbekannter Anbieter"}
                        </div>
                        <div className="stat-num text-xs text-muted">
                          {formatDate(inv.invoiceDate)}
                        </div>
                      </div>
                      <div className="shrink-0 stat-num text-sm text-ink">
                        {formatAmount(inv.amountGross, inv.currency)}
                      </div>
                      <ChevronRight size={14} className="shrink-0 text-muted" aria-hidden />
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}

      {/* ── DESKTOP DASHBOARD ───────────────────────────────────────────────── */}

      {/* MONAT IN REVIEW */}
      {!isFresh && (
        <section className="hidden md:block mt-8 md:mt-16">
          {/* Section header line — subtle */}
          <div className="flex items-baseline justify-between border-b border-line pb-3">
            <div className="text-xs text-muted">{monthLabel} · bis heute</div>
            <div className="text-xs text-muted/70">{obsLabel}</div>
          </div>

          {/* Big number + DailyCalendar — 5/7 split */}
          <div className="grid grid-cols-12 items-end gap-x-4 gap-y-4 border-b border-line pb-6 pt-4 md:gap-x-8 md:gap-y-8 md:pb-10 md:pt-8">
            <div className="col-span-12 md:col-span-5">
              <MonthKpiClient
                total={monthly.total}
                deltaPercent={monthly.deltaPercent}
                prevTotal={monthly.prevTotal}
                prevMonthLabel={prevMonthLabel}
                olderMonths={olderMonths}
              />
            </div>

            <div className="hidden md:col-span-7 md:block">
              <DailyCalendar data={daily} />
            </div>
          </div>

          {/* Secondary stats — 4 cols, font-display — matches Claude Design */}
          <div className="grid grid-cols-2 pt-6 text-sm md:grid-cols-4">
            {/* Auto-Pilot days without manual intervention */}
            <div className="md:border-r md:border-line md:pr-6">
              <div className="font-display text-xl text-ink sm:text-2xl stat-num sm:text-3xl">
                {secondary.daysSinceLastIntervention != null
                  ? <>{secondary.daysSinceLastIntervention} <span className="text-lg text-muted">Tage</span></>
                  : "—"}
              </div>
              <div className="mt-1 text-xs text-muted">Auto-Pilot ohne Eingriff</div>
            </div>

            {/* Median latency */}
            <div className="hidden md:block md:mt-0 md:border-r md:border-line md:px-6">
              <div className="font-display text-xl text-ink sm:text-2xl stat-num sm:text-3xl">
                {secondary.avgLatencyMin != null ? `⌀ ${secondary.avgLatencyMin} Min` : "—"}
              </div>
              <div className="mt-1 text-xs text-muted">Eingang → Versand · Median</div>
            </div>

            {/* Filtered this month */}
            {secondary.filteredThisMonth > 0 ? (
              <div
                className="hidden md:block md:mt-0 md:border-r md:border-line md:px-6 cursor-help"
                title="Spam, Newsletter, Duplikate — nicht weitergeleitet."
              >
                <div className="font-display text-xl text-ink sm:text-2xl stat-num sm:text-3xl">
                  {secondary.filteredThisMonth} <span className="text-lg text-muted">gefiltert</span>
                </div>
                <div className="mt-1 text-xs text-muted">Spam · Duplikate · Newsletter</div>
              </div>
            ) : (
              <div
                className="hidden md:flex md:items-center md:border-r md:border-line md:px-6 cursor-help"
                title="Infetch filtert Spam, Newsletter und Duplikate automatisch heraus. Diesen Monat noch nichts gefiltert."
              >
                <span className="text-muted/40 text-sm select-none">∅</span>
              </div>
            )}

            {/* Forecast rest of month */}
            <Link
              href="/audit?tab=review"
              className="group hidden md:block md:mt-0 md:pl-6 text-left"
            >
              <div className="font-display text-xl text-ink sm:text-2xl stat-num sm:text-3xl group-hover:underline underline-offset-4 decoration-line">
                {secondary.forecastRestMonth != null && secondary.forecastRestMonth > 0
                  ? `+${secondary.forecastRestMonth}`
                  : "—"}
              </div>
              <div className="mt-1 text-xs text-muted">Forecast Restmonat · {monthEndLabel}</div>
            </Link>
          </div>
        </section>
      )}

      {/* WORAUF WIR ACHTEN — auf Mobile ausgeblendet */}
      {!isFresh && anomalies.length > 0 && (
        <section className="hidden md:block mt-8 md:mt-16">
          <div className="flex items-baseline justify-between border-b border-line pb-3">
            <div className="font-display text-xl text-ink sm:text-2xl">Worauf wir achten</div>
          </div>
          <ul className="mt-1">
            {anomalies.map((a, i) => (
              <li key={`${a.vendor}-${i}`}>
                <Link
                  href={a.href}
                  className="row-hover flex w-full cursor-pointer items-center gap-4 border-b border-line py-4 text-left"
                >
                  <VendorLogo name={a.vendor} domain={a.domain} size={28} />
                  <span className="shrink-0 text-sm text-ink">{a.vendor}</span>
                  <span className="flex-1 truncate text-sm text-muted">{a.reason}</span>
                  <ChevronRight className="shrink-0 text-muted" size={16} aria-hidden />
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}

      {/* TOP ANBIETER — auf Mobile ausgeblendet (→ /senders) */}
      {!isFresh && topVendors.length > 0 && (
        <section className="hidden md:block mt-8 md:mt-16">
          <div className="flex items-baseline justify-between border-b border-line pb-3">
            <div className="font-display text-xl text-ink sm:text-2xl">Top-Anbieter</div>
            <Link
              href="/senders"
              className="text-xs text-muted underline decoration-line underline-offset-4 hover:text-ink"
            >
              Alle Anbieter
            </Link>
          </div>
          <ul className="mt-6 grid grid-cols-2 gap-x-6 gap-y-8 md:grid-cols-5">
            {topVendors.slice(0, 5).map((v) => {
              const trend = v.deltaPrevMonth > 0 ? "↗" : v.deltaPrevMonth < 0 ? "↘" : "→";
              const deltaLabel = v.deltaPrevMonth > 0 ? `+${v.deltaPrevMonth}` : v.deltaPrevMonth.toString();
              return (
                <li key={v.vendorName}>
                  <Link href="/senders" className="group flex flex-col gap-3">
                    <VendorLogo name={v.vendorName} domain={v.vendorDomain} size={40} />
                    <div>
                      <div className="truncate text-sm text-ink underline-offset-4 decoration-line group-hover:underline">
                        {v.vendorName}
                      </div>
                      <div className="mt-0.5 stat-num text-xs text-muted">
                        {v.count} × · {currencyEUR(v.sumGross)}{" "}
                        <span className="text-muted/70">
                          · {trend} {deltaLabel}
                        </span>
                      </div>
                    </div>
                  </Link>
                </li>
              );
            })}
          </ul>
        </section>
      )}

      {/* TRUST BAND — auf Mobile ausgeblendet */}
      {!isFresh && (
        <section className="hidden md:block mt-8 border-t border-line pt-6 md:mt-16">
          <dl className="grid grid-cols-2 gap-y-4 text-xs md:grid-cols-5">
            <div>
              <dt className="text-muted">Klassifikation korrekt</dt>
              <dd className="mt-0.5 stat-num text-ink">
                {stats.exportedLifetime > 0
                  ? `${(((stats.exportedLifetime - stats.needsReview) / stats.exportedLifetime) * 100).toFixed(1)} %`
                  : "—"}
              </dd>
            </div>
            <div>
              <dt className="text-muted">Manuell korrigiert</dt>
              <dd className="mt-0.5 stat-num text-ink">
                {stats.needsReview} / {stats.exportedLifetime + stats.needsReview}
              </dd>
            </div>
            <div>
              <dt className="text-muted">Postfach verbunden seit</dt>
              <dd className="mt-0.5 stat-num text-ink">
                {stats.daysActive !== null
                  ? `${stats.daysActive} ${stats.daysActive === 1 ? "Tag" : "Tagen"} ohne Fehler`
                  : setup.imapConfigured ? "aktiv" : "—"}
              </dd>
            </div>
            <div>
              <dt className="text-muted">Letzter Scan</dt>
              <dd className="mt-0.5 stat-num text-ink">{lastScanLabel}</dd>
            </div>
            <div>
              <dt className="text-muted">Erfolgreich versendet</dt>
              <dd className="mt-0.5 stat-num text-ink">
                {stats.exportedLifetime > 0 ? `${stats.exportedLifetime} Rechnungen` : "—"}
              </dd>
            </div>
          </dl>
          {setup.imapConfigured && (
            <div className="mt-4 text-[11px] text-muted">
              Scan-Reichweite: ab <span className="stat-num text-ink">{scanSinceLabel}</span>{" "}
              ({tierLabel}
              {tier === "free" && " — Pro holt 6 Monate, Retroaktiv-Scan 12 Monate"}).
            </div>
          )}
        </section>
      )}
    </div>
  );
}

