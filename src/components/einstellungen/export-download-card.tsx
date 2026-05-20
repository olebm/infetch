"use client";

import { useActionState, useState } from "react";
import { Download } from "lucide-react";
import { ProBadge } from "@/components/ui/pro-badge";
import { Card, CardHeader } from "@/components/ui/card";
import {
  deleteAccountAction,
  type AccountDeletionState,
} from "@/app/(app)/einstellungen/actions";

export type VendorOption = { id: number; name: string };

type Props = {
  years: number[];
  vendors: VendorOption[];
  isPro: boolean;
  email: string;
};

const DELETE_INITIAL: AccountDeletionState = { status: "idle", message: "" };

export function ExportDownloadCard({ years, vendors, isPro, email }: Props) {
  const [year, setYear]     = useState<string>("");
  const [vendor, setVendor] = useState<string>("");
  const [confirm, setConfirm] = useState<string>("");
  const [showDeleteModal, setShowDeleteModal] = useState(false);
  const [deleteState, deleteAction, deletePending] = useActionState(
    deleteAccountAction,
    DELETE_INITIAL,
  );

  const confirmMatches =
    confirm.trim().toLowerCase() === email.trim().toLowerCase() &&
    email.length > 0;

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
              disabled={vendors.length === 0}
              className="h-9 w-full rounded border border-line bg-surface px-3 text-sm outline-none focus:border-brand focus:ring-2 focus:ring-brand/20 disabled:cursor-not-allowed disabled:opacity-50"
            >
              <option value="">
                {vendors.length === 0
                  ? "Noch keine Anbieter erkannt"
                  : isPro
                    ? "Alle Anbieter"
                    : "Anbieter wählen…"}
              </option>
              {vendors.map((v) => (
                <option key={v.id} value={String(v.id)}>
                  {v.name}
                </option>
              ))}
            </select>
            {vendors.length === 0 && (
              <p className="mt-1 text-[11px] text-muted">
                Sobald Rechnungen eintreffen, erscheinen sie hier.
              </p>
            )}
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
      <div>
        <div className="text-sm font-medium text-ink">Konto löschen</div>
        <div className="mt-0.5 text-xs text-muted">
          Dein Konto, dein Arbeitsbereich und alle hochgeladenen Rechnungen
          werden sofort und unwiderruflich gelöscht. Ein laufendes Abo wird
          gekündigt. Diese Aktion kann nicht rückgängig gemacht werden.
        </div>

        <form action={deleteAction} className="mt-3 space-y-2">
          <label className="block text-xs text-muted">
            Zur Bestätigung deine E-Mail-Adresse{" "}
            <span className="font-mono text-ink">{email}</span> eingeben:
          </label>
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
            <input
              type="email"
              name="confirm"
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
              autoComplete="off"
              placeholder={email}
              className="h-9 w-full rounded border border-line bg-surface px-3 text-sm outline-none focus:border-danger focus:ring-2 focus:ring-danger/20 sm:max-w-xs"
            />
            <button
              type="button"
              disabled={!confirmMatches || deletePending}
              onClick={() => setShowDeleteModal(true)}
              className="inline-flex h-9 shrink-0 items-center justify-center gap-2 rounded border border-danger/30 bg-danger-soft px-4 text-sm text-danger transition-colors hover:border-danger/60 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {deletePending ? "Wird gelöscht…" : "Konto endgültig löschen"}
            </button>
          </div>
          {deleteState.status === "error" && (
            <div className="text-xs text-danger">{deleteState.message}</div>
          )}

          {/* Bestätigungs-Modal — bewusst leichtgewichtig (kein Wort-Tippen),
              schützt aber vor Fehlklicks. Submit erfolgt aus dem Modal über
              denselben Form-Action — der hidden submit-Button ruft `confirm`
              aus dem Outer-Form ab, das ihn umschließt. */}
          {showDeleteModal && (
            <div
              role="dialog"
              aria-modal="true"
              aria-labelledby="delete-modal-title"
              className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
              onClick={(e) => {
                if (e.target === e.currentTarget) setShowDeleteModal(false);
              }}
            >
              <div className="w-full max-w-md rounded-lg border border-line bg-paper p-6 shadow-lg">
                <div id="delete-modal-title" className="text-base font-semibold text-ink">
                  Konto wirklich löschen?
                </div>
                <p className="mt-2 text-sm text-muted">
                  Deine Postfach-Verbindung, alle Rechnungen und Organisations-Daten
                  werden <strong className="text-ink">unwiderruflich</strong> gelöscht.
                  Diese Aktion kann nicht rückgängig gemacht werden.
                </p>
                <div className="mt-5 flex items-center justify-end gap-2">
                  <button
                    type="button"
                    onClick={() => setShowDeleteModal(false)}
                    disabled={deletePending}
                    className="inline-flex h-9 items-center rounded border border-line bg-white px-3 text-sm text-ink hover:bg-surface disabled:opacity-50"
                  >
                    Abbrechen
                  </button>
                  <button
                    type="submit"
                    disabled={!confirmMatches || deletePending}
                    onClick={() => {
                      // Defense-in-Depth: jegliche client-seitig persistierte
                      // Wizard-/Setup-State (sessionStorage) sofort wegfegen,
                      // bevor die Server-Action startet. Sonst könnte der
                      // User nach Neu-Anmeldung mit derselben E-Mail im
                      // selben Browser-Tab die "Geist"-Daten seines
                      // Vorgänger-Kontos sehen.
                      if (typeof window !== "undefined") {
                        try { sessionStorage.clear(); } catch {}
                      }
                    }}
                    className="inline-flex h-9 items-center gap-2 rounded border border-danger/40 bg-danger px-3 text-sm font-medium text-white hover:bg-danger/90 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    {deletePending ? "Wird gelöscht…" : "Endgültig löschen"}
                  </button>
                </div>
              </div>
            </div>
          )}
        </form>
      </div>
    </Card>
  );
}
