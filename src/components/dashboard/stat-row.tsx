import { getAutomationStats } from "@/lib/db/queries";

function Stat({
  value,
  label,
  caption,
  accent = false,
}: {
  value: number | string;
  label: string;
  caption?: string;
  accent?: boolean;
}) {
  return (
    <div>
      <div
        className={`stat-num text-2xl font-semibold tracking-tight ${
          accent ? "text-brand-deep" : "text-ink"
        }`}
      >
        {typeof value === "number" ? value.toLocaleString("de-DE") : value}
      </div>
      <div className="mt-1 text-sm text-muted">{label}</div>
      {caption && <div className="mt-0.5 text-2xs text-muted/70">{caption}</div>}
    </div>
  );
}

export async function StatRow() {
  const stats = await getAutomationStats();

  return (
    <div className="flex items-start divide-x divide-line/50 overflow-x-auto">
      <div className="min-w-0 pr-6">
        <Stat value={stats.exportedToday} label="heute versendet" />
      </div>
      <div className="min-w-0 px-6">
        <Stat value={stats.exportedThisWeek} label="diese Woche" />
      </div>
      <div className="min-w-0 px-6">
        <Stat
          value={stats.exportedLifetime}
          label="insgesamt versendet"
          caption={stats.needsReview > 0 ? `${stats.needsReview} im Review` : undefined}
        />
      </div>
      <div className="min-w-0 pl-6">
        <Stat
          value={stats.hoursSavedLifetime >= 1 ? `≈ ${stats.hoursSavedLifetime} h` : "<1 h"}
          label="Buchhaltung gespart"
          caption="Heuristik: 2 Min/Rechnung"
          accent
        />
      </div>
    </div>
  );
}
