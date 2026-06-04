"use client";

import { useState } from "react";
import { Trash2 } from "lucide-react";
import { deleteSmtpAccountAction } from "@/app/(app)/einstellungen/actions";

/**
 * Löscht das 2. Absende-Konto (secondary). Nur für secondary gedacht — Konto 1
 * ist Pflicht. Inline-Bestätigung analog RemoveTargetButton.
 */
export function DeleteSmtpAccountButton() {
  const [confirm, setConfirm] = useState(false);

  if (confirm) {
    return (
      <div className="inline-flex shrink-0 items-center gap-2">
        <form action={deleteSmtpAccountAction}>
          <input type="hidden" name="mailSlot" value="secondary" />
          <button
            type="submit"
            className="inline-flex items-center px-1 py-2 -mx-1 text-xs font-medium text-danger underline underline-offset-4 decoration-danger hover:no-underline"
          >
            Ja, löschen
          </button>
        </form>
        <button
          type="button"
          onClick={() => setConfirm(false)}
          className="py-2 text-xs text-muted hover:text-ink"
        >
          Abbrechen
        </button>
      </div>
    );
  }

  return (
    <button
      type="button"
      onClick={() => setConfirm(true)}
      aria-label="2. Absende-Konto löschen"
      className="shrink-0 rounded border border-line px-2 py-1.5 text-muted hover:border-danger/50 hover:text-danger"
    >
      <Trash2 size={13} aria-hidden />
    </button>
  );
}
