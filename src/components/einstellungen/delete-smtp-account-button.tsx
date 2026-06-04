"use client";

import { useState, useTransition } from "react";
import { Trash2 } from "lucide-react";
import { deleteSmtpAccountAction } from "@/app/(app)/einstellungen/actions";

/**
 * Löscht das 2. Absende-Konto (secondary). Nur für secondary gedacht — Konto 1
 * ist Pflicht. Inline-Bestätigung; ruft nach Erfolg onDeleted auf (z.B. um das
 * umgebende "Ändern"-Modal zu schließen).
 */
export function DeleteSmtpAccountButton({ onDeleted }: { onDeleted?: () => void }) {
  const [confirm, setConfirm] = useState(false);
  const [pending, startTransition] = useTransition();

  function handleDelete() {
    const formData = new FormData();
    formData.set("mailSlot", "secondary");
    startTransition(async () => {
      await deleteSmtpAccountAction(formData);
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
          {pending ? "Lösche…" : "Ja, löschen"}
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
      Löschen
    </button>
  );
}
