"use client";

import { useActionState } from "react";
import { SearchCheck } from "lucide-react";
import { runMissingCheckAction, type MissingCheckState } from "@/app/(app)/fehlt/actions";

const initialState: MissingCheckState = {
  status: "idle",
  message:
    "Berechnet lokal, welche Vendor/Monat-Kombinationen fehlen und Portal-Fallback brauchen.",
};

export function MissingCheckForm() {
  const [state, formAction, isPending] = useActionState(runMissingCheckAction, initialState);

  return (
    <form action={formAction} className="rounded border border-line bg-white p-4 shadow-soft">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <div className="text-sm font-semibold">Missing Check</div>
          <p className="mt-1 text-sm text-muted">{state.message}</p>
        </div>
        <button
          type="submit"
          disabled={isPending}
          className="inline-flex items-center justify-center gap-2 rounded bg-brand px-4 py-2 text-sm font-medium text-white disabled:cursor-not-allowed disabled:opacity-60"
        >
          <SearchCheck className="h-4 w-4" aria-hidden />
          {isPending ? "Prüfe..." : "Fehlende Rechnungen berechnen"}
        </button>
      </div>
    </form>
  );
}
