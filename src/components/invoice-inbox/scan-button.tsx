"use client";

import { useActionState } from "react";
import { Loader2, RefreshCw } from "lucide-react";
import { runImapScanAction } from "@/app/(app)/einstellungen/actions";

const idle = { status: "idle" as const, message: "" };

/**
 * "Sofort holen" button for the Posteingang PageHeader.
 * Client Component wrapping the server action from Einstellungen.
 */
export function ScanButton() {
  const [, action, pending] = useActionState(runImapScanAction, idle);
  return (
    <form action={action}>
      <button
        type="submit"
        disabled={pending}
        className="inline-flex h-9 items-center gap-1.5 rounded border border-line bg-paper px-3 text-sm text-ink transition-colors hover:bg-surface disabled:cursor-not-allowed disabled:opacity-50"
      >
        {pending ? (
          <Loader2 size={14} className="animate-spin" aria-hidden />
        ) : (
          <RefreshCw size={14} aria-hidden />
        )}
        {pending ? "lädt…" : "sofort holen"}
      </button>
    </form>
  );
}
