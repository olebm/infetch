"use client";

import { useActionState } from "react";
import { History, Loader2 } from "lucide-react";
import { backfillSendersAction, type SenderActionState } from "@/app/(app)/senders/actions";

const initialState: SenderActionState = { status: "idle", message: "" };

export function BackfillSendersButton() {
  const [state, formAction, isPending] = useActionState(backfillSendersAction, initialState);

  return (
    <form action={formAction} className="flex flex-col items-end gap-1">
      <button
        type="submit"
        disabled={isPending}
        className="inline-flex items-center justify-center gap-2 rounded border border-line bg-paper px-4 py-2 text-sm font-medium hover:bg-surface disabled:cursor-not-allowed disabled:opacity-60"
      >
        {isPending ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <History className="h-4 w-4" aria-hidden />}
        {isPending ? "Backfill läuft..." : "Aus Mail-Historie befüllen"}
      </button>
      {state.status !== "idle" && state.message && (
        <p
          className={`max-w-md text-right text-xs ${
            state.status === "error" ? "text-danger" : "text-ok"
          }`}
        >
          {state.message}
        </p>
      )}
    </form>
  );
}
