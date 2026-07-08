"use client";

import { useState, useTransition } from "react";
import { Trash2 } from "lucide-react";
import { Modal } from "@/components/ui/modal";
import { deleteImapAccountAction } from "@/app/(app)/einstellungen/actions";

/**
 * Entfernt ein sekundäres/tertiäres Empfangs-Postfach (IMAP). Nicht für das
 * primäre Postfach (Pflicht-Empfang). Ein Icon-Button öffnet einen Bestätigungs-
 * Dialog; ruft nach Erfolg onDeleted auf (z. B. um ein umgebendes Modal zu
 * schließen). Bereits importierte Rechnungen bleiben erhalten.
 */
export function DeleteImapAccountButton({
  slot,
  onDeleted,
}: {
  slot: "secondary" | "tertiary";
  onDeleted?: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();

  function handleDelete() {
    const formData = new FormData();
    formData.set("mailSlot", slot);
    startTransition(async () => {
      await deleteImapAccountAction(formData);
      setOpen(false);
      onDeleted?.();
    });
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label="Postfach entfernen"
        title="Postfach entfernen"
        className="inline-flex shrink-0 items-center justify-center rounded border border-line p-1.5 text-muted hover:border-danger/50 hover:text-danger"
      >
        <Trash2 size={14} aria-hidden />
      </button>

      <Modal open={open} onClose={() => setOpen(false)} title="Postfach entfernen?" size="sm">
        <div className="space-y-5">
          <p className="text-sm text-muted">
            Das Postfach wird aus dem Empfang entfernt und nicht mehr nach Rechnungen durchsucht.
            Bereits importierte Rechnungen bleiben erhalten.
          </p>
          <div className="flex justify-end gap-2">
            <button
              type="button"
              onClick={() => setOpen(false)}
              disabled={pending}
              className="rounded border border-line px-4 py-2 text-sm text-muted hover:text-ink disabled:opacity-60"
            >
              Abbrechen
            </button>
            <button
              type="button"
              onClick={handleDelete}
              disabled={pending}
              className="inline-flex items-center gap-1.5 rounded bg-danger px-4 py-2 text-sm font-medium text-white hover:bg-danger/90 disabled:opacity-60"
            >
              <Trash2 size={14} aria-hidden />
              {pending ? "Entferne…" : "Ja, entfernen"}
            </button>
          </div>
        </div>
      </Modal>
    </>
  );
}
