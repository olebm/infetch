"use client";

import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Search, ChevronRight, Download, X } from "lucide-react";
import { VendorLogo } from "@/components/ui/vendor-logo";
import { PageHeader } from "@/components/ui/page-header";
import type { SenderWithStats, VendorInvoiceRow } from "@/lib/db/queries";
import {
  blockSenderAction,
  unblockSenderAction,
} from "@/app/(app)/senders/actions";

// ─── Helpers ─────────────────────────────────────────────────────────────────

function fmtEur(n: number) {
  return (
    n.toLocaleString("de-DE", {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }) + " €"
  );
}

function fmtDate(iso: string | null | undefined): string {
  if (!iso) return "–";
  const d = new Date(iso);
  if (isNaN(d.getTime())) return "–";
  return d.toLocaleDateString("de-DE", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

function monthLabel(iso: string | null | undefined): string {
  if (!iso) return "Unbekannt";
  const d = new Date(iso);
  if (isNaN(d.getTime())) return "Unbekannt";
  return d.toLocaleDateString("de-DE", { month: "long", year: "numeric" });
}

type Sort = "sum" | "count" | "name";

// ─── Main component ───────────────────────────────────────────────────────────

export function SendersView({
  senders,
  selectedSenderId,
  vendorInvoices,
}: {
  senders: SenderWithStats[];
  selectedSenderId: number | null;
  vendorInvoices: VendorInvoiceRow[] | null;
}) {
  const router = useRouter();
  const [q, setQ] = useState("");
  const [sort, setSort] = useState<Sort>("sum");

  const totalCount = senders.reduce((s, a) => s + a.importedCount, 0);
  const totalSum   = senders.reduce((s, a) => s + a.invoiceSum,    0);

  const visible = useMemo(() => {
    const needle = q.trim().toLowerCase();
    const filtered = senders.filter((s) => {
      if (!needle) return true;
      const name = (s.displayName ?? s.matchedVendorName ?? "").toLowerCase();
      return (
        name.includes(needle) ||
        s.fromDomain.includes(needle) ||
        (s.vendorCategory?.toLowerCase().includes(needle) ?? false)
      );
    });
    return [...filtered].sort((a, b) => {
      if (sort === "sum")   return b.invoiceSum    - a.invoiceSum;
      if (sort === "count") return b.importedCount - a.importedCount;
      if (sort === "name") {
        const na = (a.displayName ?? a.matchedVendorName ?? a.fromDomain);
        const nb = (b.displayName ?? b.matchedVendorName ?? b.fromDomain);
        return na.localeCompare(nb, "de");
      }
      return 0;
    });
  }, [senders, q, sort]);

  const selectedSender = selectedSenderId
    ? senders.find((s) => s.id === selectedSenderId) ?? null
    : null;

  // 4b — restore scroll position when returning to list
  const didRestoreScroll = useRef(false);
  useEffect(() => {
    if (selectedSender) return; // in detail view — nothing to restore
    if (didRestoreScroll.current) return;
    didRestoreScroll.current = true;
    const saved = sessionStorage.getItem("senders-scroll");
    if (saved) {
      sessionStorage.removeItem("senders-scroll");
      requestAnimationFrame(() => window.scrollTo({ top: Number(saved), behavior: "instant" }));
    }
  }, [selectedSender]);

  function openDetail(id: number) {
    sessionStorage.setItem("senders-scroll", String(window.scrollY));
    router.push(`/senders?sender=${id}`);
  }

  function closeDetail() {
    router.push("/senders");
  }

  // ── Detail view ────────────────────────────────────────────────────────────
  if (selectedSender) {
    return (
      <SenderDetail
        sender={selectedSender}
        invoices={vendorInvoices ?? []}
        back={closeDetail}
      />
    );
  }

  // ── List view ──────────────────────────────────────────────────────────────
  return (
    <div>
      <PageHeader
        title="Anbieter"
        subline={`${senders.length} Anbieter · ${totalCount} Rechnungen · ${fmtEur(totalSum)} gesamt`}
      />

      <div className="mt-8 border-t border-line">
        {/* Search + sort */}
        <div className="flex flex-col gap-3 border-b border-line py-4 md:flex-row md:items-center md:justify-between">
          <div className="flex h-10 w-full items-center gap-2 rounded border border-line bg-paper px-3 md:w-80">
            <Search size={15} className="shrink-0 text-muted/60" aria-hidden />
            <input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Suchen…"
              aria-label="Suche"
              className="flex-1 bg-transparent text-sm text-ink placeholder:text-muted/50 outline-none"
            />
            {q && (
              <button
                type="button"
                onClick={() => setQ("")}
                aria-label="Suche löschen"
                className="flex h-6 w-6 shrink-0 items-center justify-center text-muted/60 transition-colors hover:text-muted"
              >
                <X size={14} />
              </button>
            )}
          </div>
          <div className="flex items-center gap-1 text-xs">
            {(
              [
                { id: "sum"   as const, label: "Summe"  },
                { id: "count" as const, label: "Anzahl" },
                { id: "name"  as const, label: "Name"   },
              ]
            ).map((o) => (
              <button
                key={o.id}
                onClick={() => setSort(o.id)}
                className={`h-7 rounded px-2.5 ${
                  sort === o.id
                    ? "bg-ink text-white"
                    : "text-muted hover:text-ink"
                }`}
              >
                {o.label}
              </button>
            ))}
          </div>
        </div>

        {/* Rows */}
        <ul>
          {visible.map((s) => {
            const name = s.displayName ?? s.matchedVendorName ?? s.fromDomain;
            return (
              <li key={s.id}>
                <button
                  onClick={() => openDetail(s.id)}
                  className="row-hover flex w-full cursor-pointer items-center gap-4 border-b border-line py-4 text-left"
                >
                  <VendorLogo domain={s.fromDomain} name={name} size={36} />

                  <div className="min-w-0 flex-1">
                    <div className="flex items-baseline gap-3">
                      <div className="truncate text-sm font-medium text-ink">
                        {name}
                      </div>
                      {s.blocked ? (
                        <span className="inline-flex items-center gap-1 text-xs text-muted">
                          <span className="inline-block h-1.5 w-1.5 rounded-full bg-muted" />
                          Privat
                        </span>
                      ) : s.vendorCategory ? (
                        <span className="truncate text-xs text-muted">
                          {s.vendorCategory}
                        </span>
                      ) : null}
                    </div>
                    <div className="stat-num mt-1 text-xs text-muted">
                      {s.fromDomain} · letzter Eingang {fmtDate(s.lastSeenAt)}
                    </div>
                  </div>

                  <div className="shrink-0 text-right">
                    <div className="stat-num text-sm text-ink">
                      {s.invoiceSum > 0 ? fmtEur(s.invoiceSum) : "–"}
                    </div>
                    <div className="stat-num mt-0.5 text-xs text-muted">
                      {s.importedCount} Rechnungen
                    </div>
                  </div>

                  <ChevronRight size={16} className="ml-1 shrink-0 text-muted" />
                </button>
              </li>
            );
          })}

          {visible.length === 0 && (
            <li className="py-12 text-center text-sm text-muted">
              {senders.length === 0
                ? "Noch keine Anbieter erfasst — Rechnungen einlesen oder ersten Scan starten."
                : `Kein Anbieter passt zu „${q}".`}
            </li>
          )}
        </ul>

        {visible.length > 0 && (
          <p className="py-3 text-xs text-muted">
            {visible.length} von {senders.length} sichtbar
          </p>
        )}
      </div>
    </div>
  );
}

// ─── Detail ───────────────────────────────────────────────────────────────────

function SenderDetail({
  sender,
  invoices,
  back,
}: {
  sender: SenderWithStats;
  invoices: VendorInvoiceRow[];
  back: () => void;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [feedbackMsg, setFeedbackMsg] = useState<string | null>(null);

  // 4a — auto-clear feedback after 2.5 s
  useEffect(() => {
    if (!feedbackMsg) return;
    const t = setTimeout(() => setFeedbackMsg(null), 2500);
    return () => clearTimeout(t);
  }, [feedbackMsg]);

  const name = sender.displayName ?? sender.matchedVendorName ?? sender.fromDomain;

  const exportedInvoices = invoices.filter((i) => i.status === "exported");
  const avg =
    exportedInvoices.length > 0 && sender.invoiceSum > 0
      ? sender.invoiceSum / exportedInvoices.length
      : null;

  const firstYear = new Date(sender.firstSeenAt).getFullYear().toString();

  // Group by month
  const byMonth = useMemo(() => {
    const map = new Map<string, VendorInvoiceRow[]>();
    for (const inv of invoices) {
      const key = monthLabel(inv.invoiceDate ?? inv.createdAt);
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(inv);
    }
    return Array.from(map.entries());
  }, [invoices]);

  function toggleBlocked() {
    startTransition(async () => {
      const fd = new FormData();
      fd.set("senderId", String(sender.id));
      if (sender.blocked) {
        await unblockSenderAction({ status: "idle", message: "" }, fd);
        setFeedbackMsg("Wiederhergestellt");
      } else {
        fd.set("reason", "Privat");
        await blockSenderAction({ status: "idle", message: "" }, fd);
        setFeedbackMsg("Als Privat markiert");
      }
      router.refresh();
    });
  }

  const statusLabel = (s: string) => {
    if (s === "needs_review") return "prüfen";
    if (s === "exported")     return "versendet";
    if (s === "new")          return "neu";
    if (s === "ready")        return "bereit";
    if (s === "ignored")      return "ignoriert";
    if (s === "duplicate")    return "Duplikat";
    return s;
  };

  return (
    <div className="space-y-8">

      {/* Breadcrumb */}
      <div className="text-xs">
        <button
          onClick={back}
          className="text-muted underline decoration-line underline-offset-4 hover:text-ink"
        >
          ‹ Alle Anbieter
        </button>
      </div>

      {/* Header */}
      <div className="flex flex-col gap-6 border-b border-line pb-8 md:flex-row md:items-end md:justify-between md:gap-10">
        <div className="flex items-center gap-5">
          <VendorLogo domain={sender.fromDomain} name={name} size={72} />
          <div>
            <div className="text-xs text-muted">
              {sender.vendorCategory
                ? `${sender.vendorCategory} · ${sender.fromDomain}`
                : sender.fromDomain}
            </div>
            <h1 className="font-display mt-1 text-2xl text-ink sm:text-4xl md:text-5xl">
              {name}
            </h1>
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-3">
          {feedbackMsg && <span className="text-xs text-ok">{feedbackMsg}</span>}
          <button
            onClick={toggleBlocked}
            disabled={isPending}
            className="shrink-0 rounded border border-line px-3 py-1.5 text-xs font-medium text-ink transition-colors hover:border-ink disabled:opacity-50"
          >
            {isPending ? "…" : sender.blocked ? "Wiederherstellen" : "Als Privat markieren"}
          </button>
        </div>
      </div>

      {/* Stats */}
      <dl className="grid grid-cols-2 gap-x-6 gap-y-6 border-b border-line pb-8 md:grid-cols-4">
        <div>
          <dt className="text-xs text-muted">verarbeitet</dt>
          <dd className="font-display stat-num mt-1 text-2xl text-ink sm:text-3xl">
            {sender.importedCount}
          </dd>
          <dd className="mt-0.5 text-xs text-muted">Rechnungen</dd>
        </div>
        <div>
          <dt className="text-xs text-muted">gesamt</dt>
          <dd className="font-display stat-num mt-1 text-2xl text-ink sm:text-3xl">
            {sender.invoiceSum > 0 ? fmtEur(sender.invoiceSum) : "–"}
          </dd>
          {avg && avg > 0 && (
            <dd className="mt-0.5 text-xs text-muted">⌀ {fmtEur(avg)}</dd>
          )}
        </div>
        <div>
          <dt className="text-xs text-muted">Status</dt>
          <dd className="font-display mt-1 text-2xl text-ink sm:text-3xl">
            {sender.blocked ? "Privat" : "Aktiv"}
          </dd>
          <dd className="mt-0.5 text-xs text-muted">
            {sender.blocked
              ? "wird nicht weitergeleitet"
              : "wird weitergeleitet"}
          </dd>
        </div>
        <div>
          <dt className="text-xs text-muted">erfasst seit</dt>
          <dd className="font-display stat-num mt-1 text-2xl text-ink sm:text-3xl">
            {firstYear}
          </dd>
          <dd className="mt-0.5 text-xs text-muted">
            {fmtDate(sender.firstSeenAt)} · letzter{" "}
            {fmtDate(sender.lastSeenAt)}
          </dd>
        </div>
      </dl>

      {/* Download */}
      {invoices.length > 0 && (
        <div className="-mt-4 flex flex-wrap items-center justify-end gap-3">
          <a
            href={sender.matchedVendorId
              ? `/api/export/download?vendorId=${sender.matchedVendorId}`
              : `/api/export/download?senderId=${sender.id}`}
            download
            className="inline-flex items-center gap-1.5 text-xs text-muted underline decoration-line underline-offset-4 hover:text-ink"
          >
            <Download size={12} />
            Rechnungen herunterladen
          </a>
        </div>
      )}

      {/* Invoice list */}
      <section>
        <div className="flex items-baseline justify-between border-b border-line pb-3">
          <div className="font-display text-2xl text-ink">Alle Rechnungen</div>
          <div className="text-xs text-muted">{invoices.length} gesamt</div>
        </div>

        {byMonth.length === 0 ? (
          <div className="py-12 text-center text-sm text-muted">
            Noch keine Rechnungen von diesem Anbieter erfasst.
          </div>
        ) : (
          byMonth.map(([month, rows]) => {
            const monthSum = rows.reduce((s, r) => s + (r.amountGross ?? 0), 0);
            return (
              <div key={month}>
                <div className="flex items-baseline justify-between border-b border-line pb-3 pt-8">
                  <div className="font-display text-3xl leading-none text-ink">{month}</div>
                  <div className="text-xs text-muted">
                    {rows.length} {rows.length === 1 ? "Rechnung" : "Rechnungen"}
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
                  {rows.map((inv) => (
                    <li key={inv.id}>
                      <Link
                        href={`/audit/${inv.id}`}
                        className="row-hover flex w-full cursor-pointer items-center gap-4 border-b border-line py-4 text-left"
                      >
                        <div className="min-w-0 flex-1">
                          <div className="truncate text-sm font-medium text-ink">
                            {inv.invoiceNumber
                              ? `Rechnung ${inv.invoiceNumber}`
                              : `Rechnung vom ${fmtDate(inv.invoiceDate ?? inv.createdAt)}`}
                          </div>
                          <div className="stat-num mt-1 text-xs text-muted">
                            {fmtDate(inv.invoiceDate ?? inv.createdAt)}
                          </div>
                        </div>
                        <div className="stat-num shrink-0 text-sm text-ink">
                          {inv.amountGross != null ? fmtEur(inv.amountGross) : "–"}
                        </div>
                        <div className="w-20 shrink-0 text-right text-xs text-muted">
                          {statusLabel(inv.status)}
                        </div>
                        <ChevronRight size={16} className="shrink-0 text-muted" />
                      </Link>
                    </li>
                  ))}
                </ul>
              </div>
            );
          })
        )}
      </section>
    </div>
  );
}
