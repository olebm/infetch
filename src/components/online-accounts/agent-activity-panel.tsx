import { getAgentCostSummary } from "@/lib/db/queries";

export function AgentActivityPanel({ daysBack = 30 }: { daysBack?: number }) {
  const summary = getAgentCostSummary(daysBack);

  if (summary.totalRuns === 0) {
    return (
      <div className="rounded border border-dashed border-line bg-surface p-6 text-center text-sm text-muted">
        Noch keine KI-Läufe in den letzten {daysBack} Tagen. Sobald ein Online-Konto verbunden ist, siehst du hier
        Kosten und Aktivität.
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-4">
        <Stat label="Läufe" value={String(summary.totalRuns)} sub={`in ${daysBack} Tagen`} />
        <Stat
          label="Rechnungen geholt"
          value={String(summary.totalInvoices)}
          sub={summary.totalInvoices > 0 ? "automatisch" : "—"}
          tone="good"
        />
        <Stat label="KI-Aufrufe" value={String(summary.totalLlmCalls)} sub="meist beim ersten Lauf" />
        <Stat
          label="KI-Kosten"
          value={formatCents(summary.totalCostCents)}
          sub={`Ø ${formatCents(Math.round(summary.totalCostCents / Math.max(1, summary.totalRuns)))} pro Lauf`}
          tone={summary.totalCostCents > 50 ? "warn" : "good"}
        />
      </div>

      <div className="overflow-hidden rounded border border-line bg-white shadow-soft">
        <table className="w-full border-collapse text-left text-sm">
          <thead className="bg-surface text-xs uppercase text-muted">
            <tr>
              <th className="px-4 py-3">Lieferant</th>
              <th className="px-4 py-3">Läufe</th>
              <th className="px-4 py-3">Erfolgreich</th>
              <th className="px-4 py-3">Rechnungen</th>
              <th className="px-4 py-3">KI-Kosten</th>
              <th className="px-4 py-3">Ø Dauer</th>
              <th className="px-4 py-3">Zuletzt</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-line">
            {summary.byVendor.map((row) => {
              const total = row.successCount + row.failureCount;
              const successRate = total > 0 ? Math.round((row.successCount / total) * 100) : null;
              return (
                <tr key={row.vendorKey}>
                  <td className="px-4 py-3 font-medium">{row.vendorName}</td>
                  <td className="px-4 py-3 text-muted">{row.runs}</td>
                  <td className="px-4 py-3">
                    {successRate !== null ? (
                      <span
                        className={
                          successRate >= 90
                            ? "text-ok"
                            : successRate >= 50
                              ? "text-warn"
                              : "text-danger"
                        }
                      >
                        {successRate}%
                      </span>
                    ) : (
                      "—"
                    )}
                  </td>
                  <td className="px-4 py-3 text-muted">{row.invoicesFound}</td>
                  <td className="px-4 py-3 text-muted">{formatCents(row.llmCostCents)}</td>
                  <td className="px-4 py-3 text-muted">{formatDuration(row.avgDurationMs)}</td>
                  <td className="px-4 py-3 text-xs text-muted">
                    {row.lastRunAt ? formatRelative(row.lastRunAt) : "—"}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function Stat({
  label,
  value,
  sub,
  tone,
}: {
  label: string;
  value: string;
  sub?: string;
  tone?: "good" | "warn";
}) {
  const toneClass = tone === "good" ? "text-ok" : tone === "warn" ? "text-warn" : "text-ink";
  return (
    <div className="rounded border border-line bg-white p-4 shadow-soft">
      <div className="text-xs font-medium uppercase text-muted">{label}</div>
      <div className={`mt-1 text-2xl font-semibold ${toneClass}`}>{value}</div>
      {sub && <div className="mt-0.5 text-xs text-muted">{sub}</div>}
    </div>
  );
}

function formatCents(cents: number): string {
  if (cents === 0) return "0 €";
  if (cents < 100) return `${cents} ¢`;
  return `${(cents / 100).toFixed(2)} €`;
}

function formatDuration(ms: number): string {
  if (ms < 1000) return `${Math.round(ms)} ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)} s`;
  return `${(ms / 60_000).toFixed(1)} min`;
}

function formatRelative(value: string): string {
  const ts = new Date(value.includes("T") ? value : value.replace(" ", "T") + "Z");
  if (Number.isNaN(ts.getTime())) return value;
  const diffSec = Math.round((Date.now() - ts.getTime()) / 1000);
  if (diffSec < 60) return "gerade eben";
  const diffMin = Math.round(diffSec / 60);
  if (diffMin < 60) return `vor ${diffMin} Min`;
  const diffH = Math.round(diffMin / 60);
  if (diffH < 24) return `vor ${diffH} Std`;
  const diffD = Math.round(diffH / 24);
  return `vor ${diffD} Tagen`;
}
