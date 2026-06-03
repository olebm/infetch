import { ChevronRight } from "lucide-react";
import { getExportQueue } from "@/lib/db/queries";
import { DispatchButton } from "@/components/export-queue/dispatch-button";
import { EmptyState } from "@/components/status/empty-state";
import { StatusBadge } from "@/components/status/status-badge";
import { PageHeader } from "@/components/ui/page-header";
import { VendorLogo } from "@/components/ui/vendor-logo";

function formatAmount(amount: number | null, currency: string | null): string {
  if (amount === null) return "—";
  return (
    amount.toLocaleString("de-DE", {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }) +
    " " +
    (!currency || currency === "EUR" ? "€" : currency)
  );
}

function formatSentAt(iso: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso.includes("T") ? iso : iso.replace(" ", "T") + "Z");
  const diffMs = Date.now() - d.getTime();
  const diffMin = Math.round(diffMs / 60000);
  if (diffMin < 1) return "gerade eben";
  if (diffMin < 60) return `vor ${diffMin} Min.`;
  const diffH = Math.round(diffMin / 60);
  if (diffH < 24) return `vor ${diffH} Std.`;
  const diffD = Math.round(diffH / 24);
  return `vor ${diffD} Tagen`;
}

export async function ExportQueueView() {
  const all = await getExportQueue();

  const queue = all.filter((e) => ["pending", "retry", "failed"].includes(e.status));
  const history = all.filter((e) => e.status === "sent");

  return (
    <div className="screen-enter screen-enter-active">
      <PageHeader
        title="Exports"
        subline="Was ging raus, was wartet, was hakt."
        actions={<DispatchButton />}
      />

      {/* ── Warteschlange ─────────────────────────────────────────────────── */}
      <section className="mt-2 mb-14">
        <div className="flex items-baseline justify-between border-b border-line pb-3">
          <div className="font-display text-xl leading-none text-ink sm:text-3xl">
            Warteschlange
          </div>
          <div className="text-xs text-muted">
            {queue.length === 0 ? "nichts wartet" : `${queue.length} offen`}
          </div>
        </div>

        {queue.length === 0 ? (
          <div className="py-10 text-sm text-muted">Nichts wartet — alles raus.</div>
        ) : (
          <ul>
            {queue.map((item) => (
              <li key={item.id} className="flex items-center gap-4 border-b border-line py-4">
                <VendorLogo domain={null} name={item.vendorName ?? "?"} size={32} />
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm font-medium text-ink">
                    {item.vendorName || "Unbekannter Lieferant"}
                  </div>
                  <div className="text-xs text-muted">
                    {item.targetLabel}
                    {item.lastError && (
                      <span className="ml-2 text-danger" title={item.lastError}>
                        · {item.lastError.slice(0, 60)}
                      </span>
                    )}
                  </div>
                </div>
                <div className="hidden text-right sm:block">
                  <div className="stat-num text-sm tabular-nums text-ink">
                    {formatAmount(item.amountGross, item.currency)}
                  </div>
                </div>
                <StatusBadge status={item.status} />
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* ── Verlauf ────────────────────────────────────────────────────────── */}
      <section>
        <div className="flex items-baseline justify-between border-b border-line pb-3">
          <div className="font-display text-xl leading-none text-ink sm:text-3xl">Verlauf</div>
          <div className="text-xs text-muted">letzte {history.length} Sendungen</div>
        </div>

        {history.length === 0 ? (
          <EmptyState
            title="Noch nichts versendet"
            body="Sobald Rechnungen bereit sind, schicken wir sie automatisch an deine Buchhaltung."
            action={{ label: "Empfänger einrichten", href: "/einstellungen" }}
          />
        ) : (
          <ul>
            {Object.values(
              history.reduce<Record<number, typeof history>>((acc, item) => {
                if (!acc[item.invoiceId]) acc[item.invoiceId] = [];
                acc[item.invoiceId].push(item);
                return acc;
              }, {}),
            ).map((group) => {
              const first = group[0];
              const targets = group.map((g) => g.targetLabel).join(", ");
              const latestSentAt =
                group
                  .map((g) => g.sentAt)
                  .filter(Boolean)
                  .sort()
                  .at(-1) ?? null;
              return (
                <li
                  key={first.invoiceId}
                  className="flex items-center gap-4 border-b border-line py-4"
                >
                  <VendorLogo domain={null} name={first.vendorName ?? "?"} size={32} />
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm font-medium text-ink">
                      {first.vendorName || "Unbekannter Lieferant"}
                    </div>
                    <div className="text-xs text-muted">
                      {targets} · {formatSentAt(latestSentAt)}
                    </div>
                  </div>
                  <div className="hidden text-right sm:block">
                    <div className="stat-num text-sm tabular-nums text-ink">
                      {formatAmount(first.amountGross, first.currency)}
                    </div>
                  </div>
                  <StatusBadge status={first.status} />
                  <ChevronRight size={16} className="shrink-0 text-muted" aria-hidden />
                </li>
              );
            })}
          </ul>
        )}

        {history.length > 0 && (
          <div className="py-3 text-xs text-muted">
            {
              Object.keys(
                history.reduce<Record<number, true>>((acc, i) => {
                  acc[i.invoiceId] = true;
                  return acc;
                }, {}),
              ).length
            }{" "}
            versendet
          </div>
        )}
      </section>
    </div>
  );
}
