"use client";

import { useActionState } from "react";
import { Wand2, Loader2 } from "lucide-react";
import { autoAssignSendersAction, type SenderActionState } from "@/app/(app)/senders/actions";

const initialState: SenderActionState = { status: "idle", message: "" };

export function AutoAssignSendersButton() {
  const [state, formAction, isPending] = useActionState(autoAssignSendersAction, initialState);

  return (
    <form action={formAction} className="flex flex-col items-end gap-1">
      <button
        type="submit"
        disabled={isPending}
        className="inline-flex items-center justify-center gap-2 rounded border border-ink bg-ink px-4 py-2 text-sm font-medium text-paper hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-60"
      >
        {isPending ? (
          <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
        ) : (
          <Wand2 className="h-4 w-4" aria-hidden />
        )}
        {isPending ? "Wird zugeordnet..." : "Auto-Zuordnen"}
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
