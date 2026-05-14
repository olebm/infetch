"use client";

import { useActionState } from "react";
import { RefreshCw, Loader2 } from "lucide-react";
import { runMissingCheckAction, type MissingCheckState } from "@/app/(app)/fehlt/actions";

const idle: MissingCheckState = { status: "idle", message: "" };

export function MissingRefreshButton() {
  const [, formAction, isPending] = useActionState(runMissingCheckAction, idle);

  return (
    <form action={formAction}>
      <button
        type="submit"
        disabled={isPending}
        className="inline-flex items-center gap-1.5 text-xs text-muted hover:text-ink disabled:cursor-not-allowed disabled:opacity-50"
      >
        {isPending
          ? <Loader2 size={12} className="animate-spin" aria-hidden />
          : <RefreshCw size={12} aria-hidden />}
        {isPending ? "prüfe…" : "aktualisieren"}
      </button>
    </form>
  );
}
