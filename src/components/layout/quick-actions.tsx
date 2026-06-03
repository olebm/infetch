"use client";

import { useActionState } from "react";
import { Loader2, MailSearch } from "lucide-react";
import { runImapScanAction, type CredentialFormState } from "@/app/(app)/einstellungen/actions";
import { cn } from "@/lib/utils";

const idleScan: CredentialFormState = { status: "idle", message: "" };

/**
 * Reduziert auf einen Notfall-Button "Jetzt holen".
 * Set-and-forget-Vision: keine Daily-Driver-Aktionen im Header. Auto-Pilot läuft.
 * "Was fehlt" entfällt mit /fehlt-Route. "Sofort verschicken" obsolet durch Auto-Push.
 */
export function QuickActions() {
  const [scanState, scanAction, scanPending] = useActionState(runImapScanAction, idleScan);

  return (
    <div className="hidden items-center gap-2 md:flex">
      <form action={scanAction}>
        <button
          type="submit"
          disabled={scanPending}
          className="inline-flex items-center gap-1.5 rounded border border-line bg-white px-3 py-1.5 text-xs font-medium text-ink transition hover:border-brand/40 hover:text-brand disabled:cursor-not-allowed disabled:opacity-60"
        >
          {scanPending ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />
          ) : (
            <MailSearch className="h-3.5 w-3.5" aria-hidden />
          )}
          {scanPending ? "Hole..." : "Jetzt holen"}
        </button>
      </form>
      {scanState.status !== "idle" && (
        <span
          className={cn(
            "ml-2 max-w-xs truncate text-xs",
            scanState.status === "error" ? "text-danger" : "text-ok",
          )}
          title={scanState.message}
        >
          {scanState.message}
        </span>
      )}
    </div>
  );
}
