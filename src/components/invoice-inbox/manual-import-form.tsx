"use client";

import { useActionState, useRef, useState } from "react";
import { ChevronDown, Upload } from "lucide-react";
import { importManualPdfAction, type ManualImportState } from "@/app/(app)/audit/actions";

const initialState: ManualImportState = {
  status: "idle",
  message: "Für PDFs die nicht per Mail kamen.",
};

/**
 * Manueller PDF-Upload — als zusammenklappbares Panel.
 * Das ist ein Hilfs-Feature (Backup wenn IMAP fehlt), deshalb
 * standardmäßig eingeklappt damit es den Posteingang nicht dominiert.
 */
export function ManualImportForm() {
  const [open, setOpen] = useState(false);
  const [state, formAction, isPending] = useActionState(importManualPdfAction, initialState);
  const fileInputRef = useRef<HTMLInputElement>(null);

  return (
    <div className="rounded border border-line bg-white shadow-soft">
      {/* Toggle-Header */}
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center justify-between px-4 py-3 text-left text-sm text-muted hover:text-ink"
        aria-expanded={open}
      >
        <span className="flex items-center gap-2">
          <Upload className="h-3.5 w-3.5" aria-hidden />
          PDF manuell hochladen
        </span>
        <ChevronDown
          className={`h-4 w-4 transition-transform duration-150 ${open ? "rotate-180" : ""}`}
          aria-hidden
        />
      </button>

      {/* Ausgeklappter Bereich */}
      {open && (
        <div className="border-t border-line px-4 pb-4 pt-3">
          <p className="mb-3 text-xs text-muted">
            Wir speichern sie lokal, erkennen Doppelte und lesen Daten automatisch aus, falls KI-Erkennung aktiv ist.
          </p>
          <form action={formAction} className="flex flex-col gap-3 sm:flex-row sm:items-end">
            <input
              ref={fileInputRef}
              id="invoicePdf"
              name="invoicePdf"
              type="file"
              accept="application/pdf,.pdf"
              className="flex-1 rounded border border-line bg-surface px-3 py-2 text-sm"
              required
            />
            <button
              type="submit"
              disabled={isPending}
              className="inline-flex shrink-0 items-center justify-center gap-2 rounded bg-brand px-4 py-2 text-sm font-medium text-white disabled:cursor-not-allowed disabled:opacity-60"
            >
              <Upload className="h-4 w-4" aria-hidden />
              {isPending ? "Importiere..." : "Importieren"}
            </button>
          </form>
          <div
            className={
              state.status === "error"
                ? "mt-2 rounded border border-danger/30 bg-danger-soft px-3 py-2 text-xs text-danger"
                : state.status === "duplicate"
                  ? "mt-2 rounded border border-violet-200 bg-violet-50 px-3 py-2 text-xs text-violet-800"
                  : state.status === "success"
                    ? "mt-2 rounded border border-ok/30 bg-ok-soft px-3 py-2 text-xs text-ok"
                    : "mt-2 text-xs text-muted"
            }
          >
            {state.message}
          </div>
        </div>
      )}
    </div>
  );
}
