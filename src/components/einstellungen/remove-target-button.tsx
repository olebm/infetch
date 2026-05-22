"use client";

import { useState } from "react";
import { clearExportTargetAction } from "@/app/(app)/einstellungen/actions";

export function RemoveTargetButton({ targetId }: { targetId: string }) {
  const [confirm, setConfirm] = useState(false);

  if (confirm) {
    return (
      <div className="inline-flex items-center gap-2">
        <form action={clearExportTargetAction}>
          <input type="hidden" name="targetId" value={targetId} />
          <button
            type="submit"
            className="inline-flex items-center px-1 py-2 -mx-1 text-xs font-medium text-danger underline underline-offset-4 decoration-danger hover:no-underline"
          >
            Ja, entfernen
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
      className="inline-flex items-center px-1 py-2 -mx-1 text-xs text-muted underline underline-offset-4 decoration-line hover:text-danger"
    >
      entfernen
    </button>
  );
}
