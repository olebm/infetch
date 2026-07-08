"use client";

import { useState, useTransition } from "react";
import { Trash2 } from "lucide-react";
import { deleteImapAccountAction } from "@/app/(app)/einstellungen/actions";

/**
 * Entfernt ein sekundäres/tertiäres Empfangs-Postfach (IMAP). Nicht für das
 * primäre Postfach (Pflicht-Empfang). Inline-Bestätigung; ruft nach Erfolg
 * onDeleted auf (z. B. um ein umgebendes Modal zu schließen). Bereits
 * importierte Rechnungen bleiben erhalten.
 */
export function DeleteImapAccountButton({
  slot,
  onDeleted,
}: {
  slot: "secondary" | "tertiary";
  onDeleted?: () => void;
}) {
  const [confirm, setConfirm] = useState(false);
  const [pending, startTransition] = useTransition();

  function handleDelete() {
    const formData = new FormData();
    formData.set("mailSlot", slot);
    startTransition(async () => {
      await deleteImapAccountAction(formData);
      onDeleted?.();
    });
  }

  if (confirm) {
    return (
      <div className="inline-flex shrink-0 items-center gap-2">
        <button
          type="button"
          onClick={handleDelete}
          disabled={pending}
          className="inline-flex items-center gap-1 rounded border border-danger/50 px-2.5 py-1.5 text-xs font-medium text-danger hover:bg-danger/5 disabled:opacity-60"
        >
          <Trash2 size={13} aria-hidden />
          {pending ? "Entferne…" : "Ja, entfernen"}
        </button>
        <button
          type="button"
          onClick={() => setConfirm(false)}
          disabled={pending}
          className="py-1.5 text-xs text-muted hover:text-ink disabled:opacity-60"
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
      className="inline-flex shrink-0 items-center gap-1 rounded border border-line px-2.5 py-1.5 text-xs text-muted hover:border-danger/50 hover:text-danger"
    >
      <Trash2 size={13} aria-hidden />
      Entfernen
    </button>
  );
}
