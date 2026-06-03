"use client";

import { useActionState } from "react";
import { Globe, RefreshCw } from "lucide-react";
import {
  syncCommunityRecipesAction,
  type SyncCommunityState,
} from "@/app/(app)/online-accounts/actions";

const idle: SyncCommunityState = { status: "idle", message: "" };

export function CommunitySyncButton({
  stats,
}: {
  stats: { total: number; community: number; local: number };
}) {
  const [state, formAction, isPending] = useActionState(syncCommunityRecipesAction, idle);
  return (
    <div className="flex flex-wrap items-center gap-3">
      <div className="inline-flex items-center gap-2 text-xs text-muted">
        <Globe className="h-3.5 w-3.5" aria-hidden />
        {stats.total === 0
          ? "Noch keine Recipes vorhanden"
          : `${stats.local} lokal · ${stats.community} aus Community`}
      </div>
      <form action={formAction}>
        <button
          type="submit"
          disabled={isPending}
          className="inline-flex items-center gap-1.5 rounded border border-line bg-white px-3 py-1.5 text-xs font-medium text-ink hover:border-brand/40 disabled:cursor-not-allowed disabled:opacity-60"
        >
          <RefreshCw className={`h-3.5 w-3.5 ${isPending ? "animate-spin" : ""}`} aria-hidden />
          {isPending ? "Synchronisiere..." : "Recipes aktualisieren"}
        </button>
      </form>
      {state.status !== "idle" && (
        <span className={`text-xs ${state.status === "error" ? "text-danger" : "text-ok"}`}>
          {state.message}
        </span>
      )}
    </div>
  );
}
