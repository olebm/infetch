import { Card } from "@/components/ui/card";
import { StatusBadge } from "@/components/status/status-badge";
import { getRecentScans } from "@/lib/db/queries";

const MONTHS_SHORT = [
  "Jan", "Feb", "März", "Apr", "Mai", "Jun",
  "Jul", "Aug", "Sep", "Okt", "Nov", "Dez",
];

function formatRelative(iso: string): string {
  const diffMs = Date.now() - new Date(iso).getTime();
  const diffMin = Math.round(diffMs / 60_000);
  if (diffMin < 2) return "gerade eben";
  if (diffMin < 60) return `vor ${diffMin} Min`;
  const diffH = Math.round(diffMin / 60);
  if (diffH < 24) return `vor ${diffH} Std`;
  const diffD = Math.round(diffH / 24);
  if (diffD < 7) return `vor ${diffD} Tagen`;
  const d = new Date(iso);
  return `${d.getDate()}. ${MONTHS_SHORT[d.getMonth()]}`;
}

// Mappt triggered_by aus dem Scanner (z. B. "user", "retroactive_scan") auf
// kompakte User-Labels. Cron-Runs haben oft kein triggered_by (NULL) — wir
// zeigen sie als "automatisch".
function triggerLabel(triggeredBy: string): string {
  if (triggeredBy === "retroactive_scan") return "manuell (12 Mo.)";
  if (triggeredBy === "user") return "manuell";
  return "automatisch";
}

export async function ScanHistoryCard() {
  const scans = await getRecentScans(20);

  return (
    <Card padding="lg">
      <div className="text-sm font-medium text-ink">Letzte Scans</div>
      <div className="mt-0.5 text-xs text-muted">
        Die letzten 20 Postfach-Abrufe — automatisch und manuell.
      </div>

      {scans.length === 0 ? (
        <div className="mt-4 border-t border-line pt-4 text-xs text-muted">
          Noch keine Scans. Sobald Infetch dein Postfach durchsucht, erscheinen die Läufe hier.
        </div>
      ) : (
        <ul className="mt-4 divide-y divide-line border-t border-line">
          {scans.map((scan) => (
            <li key={scan.id} className="py-3 text-xs">
              <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
                <div className="flex items-center gap-2 min-w-0">
                  <StatusBadge status={scan.status} />
                  <span className="text-muted">
                    {formatRelative(scan.startedAt)} · {triggerLabel(scan.triggeredBy)}
                  </span>
                </div>
                <div className="text-muted whitespace-nowrap stat-num">
                  {scan.messagesSeen} durchsucht · {scan.pdfsFound} PDFs · {scan.imported} importiert
                  {scan.duplicates > 0 && ` · ${scan.duplicates} Dubletten`}
                </div>
              </div>
              {scan.errorSnippet && (
                <div className="mt-1 text-danger">{scan.errorSnippet}</div>
              )}
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}
