"use client";

import { useState } from "react";
import { Download } from "lucide-react";
import { ProBadge } from "@/components/ui/pro-badge";
import { Card, CardHeader } from "@/components/ui/card";

export type VendorOption = { id: number; name: string };

type Props = {
  years: number[];
  vendors: VendorOption[];
  isPro: boolean;
};

export function ExportDownloadCard({ years, vendors, isPro }: Props) {
  const [year, setYear]     = useState<string>("");
  const [vendor, setVendor] = useState<string>("");

  // Free: vendorId muss gesetzt sein → Download pro Anbieter oder einzeln
  // Pro:  kein vendor nötig → Bulk-Export aller Rechnungen
  const freeHref = vendor
    ? `/api/export/download?vendorId=${vendor}${year ? `&year=${year}` : ""}`
    : null;

  const proHref = `/api/export/download${year ? `?year=${year}` : ""}`;

  return (
    <Card padding="lg">
      <CardHeader
        title="Daten & Konto"
        description="Export oder Löschung — sofort wirksam."
      />

      {/* ── Free: Download pro Anbieter ──────────────────────────────────── */}
      <div className="space-y-3">
        <div className="text-xs font-medium text-muted uppercase tracking-wide">Download</div>

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          {/* Vendor filter — Free + Pro */}
          <div>
            <label className="mb-1 block text-xs text-muted">Anbieter</label>
            <select
              value={vendor}
              onChange={(e) => setVendor(e.target.value)}
              className="h-9 w-full rounded border border-line bg-surface px-3 text-sm outline-none focus:border-brand focus:ring-2 focus:ring-brand/20"
            >
              <option value="">{isPro ? "Alle Anbieter" : "Anbieter wählen…"}</option>
              {vendors.map((v) => (
                <option key={v.id} value={String(v.id)}>
                  {v.name}
                </option>
              ))}
            </select>
          </div>

          {/* Year filter — Free + Pro */}
          <div>
            <label className="mb-1 block text-xs text-muted">Zeitraum</label>
            <select
              value={year}
              onChange={(e) => setYear(e.target.value)}
              className="h-9 w-full rounded border border-line bg-surface px-3 text-sm outline-none focus:border-brand focus:ring-2 focus:ring-brand/20"
            >
              <option value="">Alle Jahre</option>
              {years.map((y) => (
                <option key={y} value={String(y)}>
                  {y}
                </option>
              ))}
            </select>
          </div>

          {/* Download button */}
          <div className="flex items-end">
            {isPro ? (
              <a
                href={proHref}
                download
                className="inline-flex h-9 w-full items-center justify-center gap-2 rounded border border-line bg-surface px-4 text-sm text-ink transition-colors hover:bg-white"
              >
                <Download size={14} aria-hidden />
                Exportieren
              </a>
            ) : freeHref ? (
              <a
                href={freeHref}
                download
                className="inline-flex h-9 w-full items-center justify-center gap-2 rounded border border-line bg-surface px-4 text-sm text-ink transition-colors hover:bg-white"
              >
                <Download size={14} aria-hidden />
                Exportieren
              </a>
            ) : (
              <button
                type="button"
                disabled
                title="Bitte zuerst einen Anbieter wählen"
                className="inline-flex h-9 w-full cursor-not-allowed items-center justify-center gap-2 rounded border border-line bg-surface px-4 text-sm text-muted opacity-50"
              >
                <Download size={14} aria-hidden />
                Exportieren
              </button>
            )}
          </div>
        </div>

        {/* Free hint */}
        {!isPro && (
          <div className="flex items-center gap-2 text-xs text-muted">
            <span>Bitte Anbieter wählen.</span>
            <span>·</span>
            <span>Alle Rechnungen auf einmal:</span>
            <ProBadge feature="Alle Rechnungen exportieren" />
          </div>
        )}
      </div>

      {/* ── Arbeitsbereich verlassen ─────────────────────────────────────── */}
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

      {/* ── Konto löschen ────────────────────────────────────────────────── */}
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
