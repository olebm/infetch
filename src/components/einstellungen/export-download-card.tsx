"use client";

import { useState } from "react";
import { Download } from "lucide-react";
import { Card, CardHeader } from "@/components/ui/card";

export function ExportDownloadCard({ years }: { years: number[] }) {
  const [year, setYear] = useState<string>("");

  const href = year
    ? `/api/export/download?year=${year}`
    : `/api/export/download`;

  return (
    <Card padding="lg">
      <CardHeader
        title="Daten & Konto"
        description="Export oder Löschung — sofort wirksam."
      />

      {/* Export */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
        <div className="flex-1">
          <label className="mb-1 block text-xs font-medium text-muted">
            Zeitraum
          </label>
          <select
            value={year}
            onChange={(e) => setYear(e.target.value)}
            className="h-9 w-full rounded border border-line bg-surface px-3 text-sm outline-none focus:border-brand focus:ring-2 focus:ring-brand/20 sm:w-48"
          >
            <option value="">Alle Jahre</option>
            {years.map((y) => (
              <option key={y} value={String(y)}>
                {y}
              </option>
            ))}
          </select>
        </div>
        <a
          href={href}
          download
          className="inline-flex h-9 items-center gap-2 rounded border border-line bg-surface px-4 text-sm text-ink transition-colors hover:bg-white"
        >
          <Download size={14} aria-hidden />
          Daten exportieren
        </a>
      </div>

      {/* Arbeitsbereich verlassen */}
      <div className="mt-3">
        <button
          type="button"
          disabled
          title="Kommt bald"
          className="inline-flex h-9 cursor-not-allowed items-center gap-2 rounded border border-line bg-surface px-4 text-sm text-muted opacity-50"
        >
          Arbeitsbereich verlassen
        </button>
      </div>

      {/* Divider */}
      <div className="my-5 border-t border-line" />

      {/* Delete account */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <div className="text-sm font-medium text-ink">Konto löschen</div>
          <div className="mt-0.5 text-xs text-muted">
            Alle Daten werden unwiderruflich gelöscht. Diese Aktion kann nicht rückgängig gemacht werden.
          </div>
        </div>
        <a
          href="mailto:support@infetch.de?subject=Konto+löschen&body=Bitte+lösche+mein+Konto."
          className="inline-flex h-9 shrink-0 items-center gap-2 rounded border border-danger/30 bg-danger-soft px-4 text-sm text-danger transition-colors hover:border-danger/60"
        >
          Anfragen
        </a>
      </div>
    </Card>
  );
}
