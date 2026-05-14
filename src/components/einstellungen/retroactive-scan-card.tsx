"use client";

import { useState } from "react";
import { History, Loader2, CheckCircle2, AlertCircle } from "lucide-react";
import { ProBadge } from "@/components/ui/pro-badge";

type Props = {
  isPro: boolean;
};

type ScanState =
  | { status: "idle" }
  | { status: "running" }
  | { status: "done"; imported: number }
  | { status: "error"; message: string };

export function RetroactiveScanCard({ isPro }: Props) {
  const [scanState, setScanState] = useState<ScanState>({ status: "idle" });

  async function handleScan() {
    if (!isPro || scanState.status === "running") return;
    setScanState({ status: "running" });
    try {
      const res = await fetch("/api/scan/backfill", { method: "POST" });
      const data = await res.json();
      if (res.ok && data.ok) {
        setScanState({ status: "done", imported: data.result?.imported ?? 0 });
      } else {
        setScanState({ status: "error", message: data.error ?? "Unbekannter Fehler." });
      }
    } catch {
      setScanState({ status: "error", message: "Netzwerkfehler — bitte erneut versuchen." });
    }
  }

  return (
    <div className="flex items-start gap-3">
      <div className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded border border-line bg-surface text-muted">
        <History size={14} aria-hidden />
      </div>

      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-sm font-medium text-ink">Retroaktiver Scan</span>
          {!isPro && <ProBadge feature="Retroaktiver Scan (12 Mo.)" />}
        </div>
        <div className="mt-0.5 text-xs text-muted">
          Scannt dein Postfach 12 Monate zurück und importiert fehlende Rechnungen — zählt nicht gegen das Monatslimit.
        </div>

        {/* Status feedback */}
        {scanState.status === "done" && (
          <div className="mt-2 flex items-center gap-1.5 text-xs text-ok">
            <CheckCircle2 size={12} aria-hidden />
            {scanState.imported > 0
              ? `${scanState.imported} neue Rechnung(en) importiert.`
              : "Keine neuen Rechnungen gefunden."}
          </div>
        )}
        {scanState.status === "error" && (
          <div className="mt-2 flex items-center gap-1.5 text-xs text-danger">
            <AlertCircle size={12} aria-hidden />
            {scanState.message}
          </div>
        )}
      </div>

      {isPro ? (
        <button
          type="button"
          onClick={handleScan}
          disabled={scanState.status === "running" || scanState.status === "done"}
          className="shrink-0 inline-flex items-center gap-1.5 rounded border border-line bg-surface px-3 py-1.5 text-xs text-muted hover:border-brand/50 hover:text-ink disabled:cursor-not-allowed disabled:opacity-50"
        >
          {scanState.status === "running" ? (
            <>
              <Loader2 size={12} className="animate-spin" aria-hidden />
              Läuft…
            </>
          ) : scanState.status === "done" ? (
            <>
              <CheckCircle2 size={12} aria-hidden />
              Fertig
            </>
          ) : (
            "Jetzt scannen"
          )}
        </button>
      ) : (
        <button
          type="button"
          disabled
          className="shrink-0 inline-flex items-center gap-1.5 rounded border border-line bg-surface px-3 py-1.5 text-xs text-muted opacity-40 cursor-not-allowed"
        >
          Jetzt scannen
        </button>
      )}
    </div>
  );
}
