import { Fragment } from "react";
import Link from "next/link";
import { ChevronRight } from "lucide-react";
import {
  getInvoices,
  getPrivateInvoices,
  getPrivateInvoiceCount,
  getInvoiceStatusCounts,
  getDashboardStats,
} from "@/lib/db/queries";
import { getCurrentAuth } from "@/lib/auth/current";
import { StatusBadge } from "@/components/status/status-badge";
import { EmptyState } from "@/components/status/empty-state";
import { InboxSearch } from "@/components/invoice-inbox/inbox-search";
import { VendorLogo } from "@/components/ui/vendor-logo";
import { PageHeader } from "@/components/ui/page-header";
import { MissingListView } from "@/components/missing-matrix/missing-list-view";
import { PrivatButton, WiederherstellenButton } from "@/components/invoice-inbox/privat-popover";
import { PullToRefresh } from "@/components/invoice-inbox/pull-to-refresh";
import { StickySearchBar } from "@/components/invoice-inbox/sticky-search-bar";
import { ManualImportForm } from "@/components/invoice-inbox/manual-import-form";

// ─── Types ────────────────────────────────────────────────────────────────────

type Invoice = Awaited<ReturnType<typeof getInvoices>>[number];

// ─── Helpers ──────────────────────────────────────────────────────────────────

const MONTHS_DE = [
  "Januar", "Februar", "März", "April", "Mai", "Juni",
  "Juli", "August", "September", "Oktober", "November", "Dezember",
];

function getMonthKey(inv: Invoice): string {
  const dateStr = inv.invoiceDate || inv.createdAt;
  return dateStr.slice(0, 7); // "YYYY-MM"
}

function formatMonthLabel(monthKey: string): string {
  const [yearStr, monthStr] = monthKey.split("-");
  if (!yearStr || !monthStr) return "Kein Datum";
  const year = parseInt(yearStr, 10);
  const month = parseInt(monthStr, 10) - 1;
  return `${MONTHS_DE[month]} ${year}`;
}

function formatDate(iso: string | null): string {
  if (!iso) return "—";
  try {
    const d = new Date(iso + "T12:00:00");
    return `${String(d.getDate()).padStart(2, "0")}.${String(d.getMonth() + 1).padStart(2, "0")}.${d.getFullYear()}`;
  } catch {
    return iso;
  }
}

function formatAmount(amount: number | null, currency: string | null): string {
  if (amount === null) return "—";
  const value = amount.toLocaleString("de-DE", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
  const sym = !currency || currency === "EUR" ? "€" : currency;
  return `${value} ${sym}`;
}

function groupByMonth(invoices: Invoice[]): Array<{
  key: string;
  label: string;
  items: Invoice[];
  monthSum: number;
}> {
  const map = new Map<string, Invoice[]>();
  for (const inv of invoices) {
    const key = getMonthKey(inv);
    const existing = map.get(key);
    if (existing) existing.push(inv);
    else map.set(key, [inv]);
  }
  return Array.from(map.entries()).map(([key, items]) => ({
    key,
    label: formatMonthLabel(key),
    items,
    monthSum: items.reduce((acc, inv) => acc + (inv.amountGross ?? 0), 0),
  }));
}

// ─── Tab config ───────────────────────────────────────────────────────────────

const TABS = [
  { key: "review", label: "Bitte prüfen", statuses: ["needs_review", "new", "failed"] as string[] },
  { key: "all",    label: "Eingegangen",  statuses: null },
  { key: "sent",   label: "Versendet",    statuses: ["exported"] as string[] },
  { key: "fehlt",  label: "Fehlt",        statuses: null },
  { key: "privat", label: "Privat",       statuses: null },
] as const;

type TabKey = (typeof TABS)[number]["key"];

// ─── Component ────────────────────────────────────────────────────────────────

/**
 * Posteingang — pixel-matches Claude Design's `Inbox`.
 *
 * Tab bar with count chips + search field, flowing row list (NOT a table),
 * month separator rows with display headline + total. Hover-only row
 * actions, chevron-right at end of each row.
 */
export async function InvoiceInboxView({
  tab,
  year,
  search,
  status: legacyStatus,
}: {
  tab?: string;
  year?: string;
  search?: string;
  status?: string;
}) {
  const auth = await getCurrentAuth();
  const orgId = auth?.organization?.id ?? null;

  const [statusCountsRaw, privatCount, stats] = await Promise.all([
    getInvoiceStatusCounts(orgId),
    getPrivateInvoiceCount(orgId),
    getDashboardStats(),
  ]);
  const counts = new Map(statusCountsRaw.map((c) => [c.status, Number(c.count)]));
  const activeYear = year ?? null;

  // Resolve active tab (with legacy ?status= support)
  let activeTab: TabKey = "review";
  if (tab && TABS.some((t) => t.key === tab)) {
    activeTab = tab as TabKey;
  } else if (legacyStatus) {
    if (["needs_review", "new", "failed"].includes(legacyStatus)) activeTab = "review";
    else if (legacyStatus === "exported") activeTab = "sent";
    else activeTab = "all";
  }

  const reviewCount = ["needs_review", "new", "failed"].reduce(
    (acc, s) => acc + (counts.get(s) ?? 0), 0,
  );
  const sentCount = counts.get("exported") ?? 0;
  const allCount = Array.from(counts.values()).reduce((a, b) => a + b, 0);

  function tabHref(tabKey: string): string {
    const params = new URLSearchParams();
    if (tabKey && tabKey !== "review") params.set("tab", tabKey);
    if (activeYear) params.set("year", activeYear);
    if (search) params.set("q", search);
    const qs = params.toString();
    return qs ? `/audit?${qs}` : "/audit";
  }

  // Fetch invoices for current tab
  const invoices: Invoice[] = await (async () => {
    if (activeTab === "fehlt") return [];
    if (activeTab === "privat") {
      return (await getPrivateInvoices({
        year: activeYear ?? undefined,
        search: search || undefined,
        organizationId: orgId,
      })).slice(0, 30);
    }
    const tabCfg = TABS.find((t) => t.key === activeTab)!;
    const statusList = tabCfg.statuses;
    if (statusList) {
      // PERFORMANCE (INFETCH-99): Einzel-Query mit statuses[] statt N×getInvoices()
      return getInvoices({
        statuses: statusList,
        limit: 30,
        year: activeYear ?? undefined,
        search: search || undefined,
        organizationId: orgId,
      });
    }
    return getInvoices({
      year: activeYear ?? undefined,
      search: search || undefined,
      limit: 30,
      organizationId: orgId,
    });
  })();

  const groups = groupByMonth(invoices);

  return (
    <div className="screen-enter screen-enter-active">
      <PageHeader
        title="Posteingang"
        subline="Alles, was reinkommt — gefiltert nach Status."
      />

      {/* Pull-to-Refresh — nur auf Touch-Geräten aktiv, Desktop: kein Effekt */}
      <PullToRefresh />

      {/* Sticky-Suchleiste — nur Mobile, haftet unter der TopBar, VOR den Tabs */}
      {activeTab !== "fehlt" && activeTab !== "privat" && (
        <StickySearchBar
          initialValue={search ?? ""}
          tab={activeTab}
          year={activeYear ?? undefined}
        />
      )}

      {/* Tab bar — auf Mobile kein Sticky, scrollt normal weg */}
      <div className="flex flex-col gap-3 md:border-b md:border-line md:flex-row md:items-center md:justify-between">
        {/* Fade-Gradient am rechten Rand signalisiert weiteren Scroll-Inhalt auf Phones */}
        <div className="relative -mb-px border-b border-line md:border-none">
        <nav className="no-scrollbar flex gap-0 overflow-x-auto" aria-label="Filter">
          {TABS.map((tabItem) => {
            const isActive = activeTab === tabItem.key;
            const fehltCount = stats.missing + stats.actionRequired;
            const count =
              tabItem.key === "review" ? reviewCount
                : tabItem.key === "sent" ? sentCount
                  : tabItem.key === "all" ? allCount
                    : tabItem.key === "fehlt" ? (fehltCount > 0 ? fehltCount : null)
                      : tabItem.key === "privat" ? (privatCount > 0 ? privatCount : null)
                        : null;
            return (
              <Link
                key={tabItem.key}
                href={tabHref(tabItem.key)}
                aria-current={isActive ? "page" : undefined}
                className={`inline-flex h-11 items-center gap-1.5 whitespace-nowrap border-b-2 px-3 text-sm font-medium transition-colors md:px-4 ${
                  isActive
                    ? "border-brand text-ink"
                    : "border-transparent text-muted hover:text-ink"
                }`}
              >
                {tabItem.label}
                {count !== null && count > 0 && (
                  <span className="ml-1 rounded-full bg-line/70 px-1.5 py-0.5 text-xs text-muted">
                    {count}
                  </span>
                )}
              </Link>
            );
          })}
        </nav>
          {/* Fade signalisiert Scroll-Overflow — nur auf Phones sichtbar */}
          <div
            className="pointer-events-none absolute bottom-0 right-0 top-0 w-10 bg-gradient-to-l from-[#fbfaf7] to-transparent md:hidden"
            aria-hidden
          />
        </div>
        {/* Suche — nur Desktop inline; Mobile: via StickySearchBar weiter unten */}
        {activeTab !== "fehlt" && activeTab !== "privat" && (
          <div className="ml-auto hidden md:block">
            <InboxSearch
              initialValue={search ?? ""}
              tab={activeTab}
              year={activeYear ?? undefined}
              defaultTab="review"
            />
          </div>
        )}
      </div>

      {/* Fehlt tab content */}
      {activeTab === "fehlt" && (
        <div className="mt-6">
          <MissingListView />
        </div>
      )}

      {/* Invoice list */}
      {activeTab !== "fehlt" && (
        <div className="mt-2">
          {invoices.length === 0 ? (
            <div className="py-12">
              <EmptyState
                title={
                  search || activeYear
                    ? "Mit diesem Filter ist hier nichts"
                    : activeTab === "review"
                      ? "Nichts wartet auf dein OK"
                      : activeTab === "sent"
                        ? "Noch nichts versendet"
                        : activeTab === "privat"
                          ? "Keine privaten Rechnungen"
                          : "Noch keine Rechnungen da"
                }
                body={
                  activeTab === "review"
                    ? "Sobald der Agent unsicher ist, taucht es hier auf. Bis dahin: Kaffee."
                    : activeTab === "sent"
                      ? "Rechnungen, die der Auto-Pilot versendet hat, erscheinen hier."
                      : activeTab === "privat"
                        ? "Rechnungen, die du als privat markierst, landen hier und werden nicht weitergeleitet."
                        : search || activeYear
                          ? "Probier einen anderen Filter oder lad eine PDF hoch."
                          : "Wir warten auf die erste Rechnung. Schau in 5 Min nochmal."
                }
                action={
                  search || activeYear
                    ? { label: "Alle anzeigen", href: "/audit" }
                    : undefined
                }
              />
            </div>
          ) : (
            <div>
              {groups.map(({ key, label, items, monthSum }) => (
                <Fragment key={key}>
                  <div className="flex items-baseline justify-between border-b border-line pb-3 pt-8">
                    <div className="font-display text-xl leading-none text-ink sm:text-3xl">
                      {label}
                    </div>
                    <div className="text-xs text-muted">
                      {items.length} Rechnungen
                      {monthSum > 0 && (
                        <>
                          {" · "}
                          <span className="stat-num text-ink">
                            {monthSum.toLocaleString("de-DE", {
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
                    {items.map((invoice) => (
                      <li key={invoice.id}>
                        <Link
                          href={`/audit/${invoice.id}`}
                          className="group/row row-hover flex cursor-pointer items-center gap-4 border-b border-line py-4"
                        >
                          <VendorLogo
                            domain={invoice.vendorDomain}
                            name={invoice.vendorName}
                            size={36}
                          />
                          <div className="min-w-0 flex-1">
                            <div className="flex items-baseline gap-2">
                              <div className="truncate text-sm font-medium text-ink">
                                {invoice.vendorName || "Unbekannter Anbieter"}
                              </div>
                              {invoice.invoiceNumber && (
                                <div className="flex-1 truncate text-xs text-muted">
                                  {invoice.invoiceNumber}
                                </div>
                              )}
                            </div>
                            <div className="mt-1 stat-num text-xs text-muted">
                              {formatDate(invoice.invoiceDate)}
                            </div>
                          </div>
                          <div className="hidden whitespace-nowrap text-right stat-num text-sm tabular-nums text-ink sm:block">
                            {formatAmount(invoice.amountGross, invoice.currency)}
                          </div>
                          <div className="hidden w-24 md:block">
                            {activeTab === "privat"
                              ? <StatusBadge status="ignored" label="privat" />
                              : <StatusBadge status={invoice.status} />}
                          </div>
                          {activeTab === "privat" ? (
                            <WiederherstellenButton invoiceId={invoice.id} />
                          ) : invoice.status !== "exported" ? (
                            <PrivatButton
                              invoiceId={invoice.id}
                              domain={invoice.vendorDomain}
                            />
                          ) : <div className="w-9" />}
                          <ChevronRight
                            className="shrink-0 text-muted"
                            size={16}
                            aria-hidden
                          />
                        </Link>
                      </li>
                    ))}
                  </ul>
                </Fragment>
              ))}
              <div className="py-3 text-xs text-muted">
                {invoices.length} von {
                  activeTab === "review" ? reviewCount :
                  activeTab === "sent"   ? sentCount   :
                  activeTab === "privat" ? privatCount :
                  allCount
                } sichtbar
              </div>
            </div>
          )}
        </div>
      )}

      {/* Manueller Upload — immer sichtbar, standardmäßig eingeklappt */}
      {activeTab !== "fehlt" && activeTab !== "privat" && (
        <div className="mt-4">
          <ManualImportForm />
        </div>
      )}

    </div>
  );
}
