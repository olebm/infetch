"use client";

import { useActionState } from "react";
import { Loader2, RotateCw, Trash2 } from "lucide-react";
import {
  fetchOnlineAccountNowAction,
  removeOnlineAccountAction,
  type PortalCheckState,
} from "@/app/(app)/online-accounts/actions";

const idleCheck: PortalCheckState = { status: "idle", message: "" };

export function FetchNowButton({ vendorKey }: { vendorKey: string }) {
  const [state, formAction, isPending] = useActionState(fetchOnlineAccountNowAction, idleCheck);
  return (
    <form action={formAction} className="flex items-center gap-2">
      <input type="hidden" name="vendorKey" value={vendorKey} />
      <button
        type="submit"
        disabled={isPending}
        className="inline-flex items-center gap-1.5 rounded border border-line bg-white px-3 py-2 text-xs font-medium text-ink hover:border-brand/40 disabled:cursor-not-allowed disabled:opacity-60"
      >
        {isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden /> : <RotateCw className="h-3.5 w-3.5" aria-hidden />}
        {isPending ? "Hole..." : "Jetzt prüfen"}
      </button>
      {state.status !== "idle" && (
        <span className={`text-xs ${state.status === "error" ? "text-danger" : "text-ok"}`}>
          {state.message}
        </span>
      )}
    </form>
  );
}

export function RemoveAccountButton({ vendorKey, name }: { vendorKey: string; name: string }) {
  return (
    <form
      action={removeOnlineAccountAction}
      onSubmit={(e) => {
        if (!confirm(`${name} wirklich entfernen? Wir vergessen Login, Recipe und Browser-Sitzung.`)) {
          e.preventDefault();
        }
      }}
    >
      <input type="hidden" name="vendorKey" value={vendorKey} />
      <button
        type="submit"
        className="inline-flex items-center gap-1.5 rounded border border-line bg-white px-3 py-2 text-xs font-medium text-muted hover:border-danger/30 hover:text-danger"
        title="Entfernen"
      >
        <Trash2 className="h-3.5 w-3.5" aria-hidden />
      </button>
    </form>
  );
}
