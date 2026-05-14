"use client";

import { useActionState } from "react";
import { Send } from "lucide-react";
import { runExportDispatchAction, type ExportDispatchState } from "@/app/(app)/exports/actions";

const initialState: ExportDispatchState = { status: "idle", message: "" };

export function DispatchButton() {
  const [state, formAction, isPending] = useActionState(runExportDispatchAction, initialState);

  const messageColor =
    state.status === "success"
      ? "text-ok"
      : state.status === "error"
        ? "text-danger"
        : "text-muted";

  return (
    <form action={formAction} className="flex items-center gap-3">
      {state.status !== "idle" && (
        <p className={`text-sm ${messageColor}`}>{state.message}</p>
      )}
      <button
        type="submit"
        disabled={isPending}
        className="inline-flex items-center gap-2 rounded bg-brand px-4 py-2 text-sm font-medium text-white disabled:cursor-not-allowed disabled:opacity-60"
      >
        <Send className="h-4 w-4" aria-hidden />
        {isPending ? "Sende..." : "Jetzt senden"}
      </button>
    </form>
  );
}
