"use client";

import { useState } from "react";
import { Code2, Share2, X } from "lucide-react";

type RecipeHealthInfo = {
  vendorKey: string;
  vendorName: string;
  recipeVersion: number | null;
  recipeJson: string | null;
  recipeRecordedBy: "local" | "community" | null;
  successCount: number;
  failureCount: number;
  lastError: string | null;
};

export function RecipeHealthButton({ info }: { info: RecipeHealthInfo }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="inline-flex items-center gap-1.5 rounded border border-line bg-white px-3 py-2 text-xs font-medium text-muted hover:border-brand/40 hover:text-ink"
        title="Recipe-Details"
      >
        <Code2 className="h-3.5 w-3.5" aria-hidden />
      </button>
      {open && <RecipeHealthDrawer info={info} onClose={() => setOpen(false)} />}
    </>
  );
}

function RecipeHealthDrawer({ info, onClose }: { info: RecipeHealthInfo; onClose: () => void }) {
  const total = info.successCount + info.failureCount;
  const successRate = total > 0 ? Math.round((info.successCount / total) * 100) : null;
  const canShare = info.recipeRecordedBy === "local" && info.recipeJson && successRate !== null && successRate >= 80;
  const shareUrl = canShare
    ? buildShareUrlClient(info.vendorKey, info.recipeJson!)
    : null;

  const rateTone =
    successRate === null
      ? "text-muted"
      : successRate >= 90
        ? "text-ok"
        : successRate >= 50
          ? "text-warn"
          : "text-danger";
  const rateLabel =
    successRate === null
      ? "Noch keine Läufe"
      : successRate >= 90
        ? "Funktioniert zuverlässig"
        : successRate >= 50
          ? "Läuft, aber manchmal Aussetzer"
          : "Funktioniert nicht stabil";

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" onClick={onClose}>
      <div
        className="max-h-[85vh] w-full max-w-xl overflow-hidden rounded-lg bg-white shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-line px-5 py-4">
          <h2 className="text-base font-semibold">{info.vendorName}</h2>
          <button
            type="button"
            onClick={onClose}
            className="text-muted hover:text-ink"
            aria-label="Schließen"
          >
            <X className="h-4 w-4" aria-hidden />
          </button>
        </div>
        <div className="max-h-[70vh] space-y-4 overflow-y-auto p-5">
          <div className="text-center">
            <div className={`text-4xl font-semibold ${rateTone}`}>
              {successRate !== null ? `${successRate}%` : "—"}
            </div>
            <div className="mt-1 text-sm text-muted">{rateLabel}</div>
          </div>

          {info.lastError && (
            <div className="rounded border border-danger/30 bg-danger-soft px-4 py-3 text-sm text-danger">
              <strong>Letzter Fehler:</strong> {info.lastError}
            </div>
          )}

          {canShare && shareUrl && (
            <div className="rounded border border-ok/30 bg-ok-soft p-4 text-sm">
              <div className="flex items-start gap-3">
                <Share2 className="mt-0.5 h-4 w-4 shrink-0 text-ok" aria-hidden />
                <div className="flex-1">
                  <div className="font-medium text-ok">
                    Mit Community teilen?
                  </div>
                  <p className="mt-1 text-xs text-ok">
                    Diese Recipe läuft stabil bei dir. Andere Nutzer von {info.vendorName} sparen sich das Lernen.
                    Nur Selektoren werden geteilt — keine Credentials.
                  </p>
                  <a
                    href={shareUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="mt-2 inline-flex items-center gap-1.5 rounded bg-ok px-3 py-1.5 text-xs font-medium text-white hover:bg-ok/90"
                  >
                    Pull-Request auf GitHub erstellen
                  </a>
                </div>
              </div>
            </div>
          )}

          {info.recipeRecordedBy === "community" && (
            <div className="rounded border border-brand/30 bg-brand-soft px-4 py-3 text-xs text-brand-deep">
              Recipe aus Community-Repo. Bei eigener Aufnahme hat deine Version Vorrang.
            </div>
          )}

          <details className="rounded border border-line bg-surface">
            <summary className="cursor-pointer px-4 py-2 text-xs font-medium text-muted hover:text-ink">
              Erweitert (Debug)
            </summary>
            <div className="space-y-3 border-t border-line p-4 text-xs">
              <div className="grid grid-cols-2 gap-2 text-muted">
                <div>
                  <span className="font-medium">Version:</span>{" "}
                  {info.recipeVersion ? `v${info.recipeVersion}` : "—"}
                </div>
                <div>
                  <span className="font-medium">Läufe gesamt:</span> {total > 0 ? total : "—"}
                </div>
              </div>
              <div>
                <div className="mb-1 font-medium text-muted">Recipe-JSON</div>
                <pre className="max-h-64 overflow-auto rounded border border-line bg-white p-2 font-mono">
                  {info.recipeJson ?? "(noch keine Recipe — wird beim ersten Lauf aufgenommen)"}
                </pre>
              </div>
            </div>
          </details>
        </div>
      </div>
    </div>
  );
}

function buildShareUrlClient(vendorKey: string, recipeJson: string): string {
  const filename = `recipes/${vendorKey}.json`;
  const body = encodeURIComponent(recipeJson);
  return `https://github.com/invoice-agent/invoice-agent-recipes/new/main?filename=${encodeURIComponent(filename)}&value=${body}`;
}

