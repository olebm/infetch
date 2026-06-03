"use client";

import { useActionState } from "react";
import { ArrowRight, Loader2, MailSearch } from "lucide-react";
import { runImapScanAction, type CredentialFormState } from "@/app/(app)/einstellungen/actions";
import { cn } from "@/lib/utils";

const cardInitialState: CredentialFormState = {
  status: "idle",
  message: "Wir holen alle neuen Rechnungen aus deinem Postfach.",
};

const buttonInitialState: CredentialFormState = { status: "idle", message: "" };

export function ImapScanForm({ variant = "card" }: { variant?: "card" | "button" }) {
  const initialState = variant === "card" ? cardInitialState : buttonInitialState;
  const [state, formAction, isPending] = useActionState(runImapScanAction, initialState);

  if (variant === "button") {
    return (
      <form action={formAction} className="flex flex-col items-end gap-1">
        <button
          type="submit"
          disabled={isPending}
          className={cn(
            "inline-flex items-center justify-center gap-2 rounded bg-brand px-4 py-2 text-sm font-medium text-white shadow-soft",
            "disabled:cursor-not-allowed disabled:opacity-60",
          )}
        >
          {isPending ? (
            <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
          ) : (
            <MailSearch className="h-4 w-4" aria-hidden />
          )}
          {isPending ? "Hole Rechnungen..." : "Rechnungen abholen"}
          {!isPending && <ArrowRight className="h-4 w-4" aria-hidden />}
        </button>
        {state.status !== "idle" && state.message && (
          <p
            className={cn(
              "max-w-md text-right text-xs",
              state.status === "error" ? "text-danger" : "text-ok",
            )}
          >
            {state.message}
          </p>
        )}
      </form>
    );
  }

  return (
    <form action={formAction} className="rounded border border-line bg-white p-4 shadow-soft">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h3 className="text-sm font-semibold">Rechnungen abholen</h3>
          <p
            className={cn(
              "mt-1 text-sm",
              state.status === "error"
                ? "text-danger"
                : state.status === "success"
                  ? "text-ok"
                  : "text-muted",
            )}
          >
            {state.message}
          </p>
        </div>
        <button
          type="submit"
          disabled={isPending}
          className="inline-flex items-center justify-center gap-2 rounded bg-brand px-4 py-2 text-sm font-medium text-white disabled:cursor-not-allowed disabled:opacity-60"
        >
          {isPending ? (
            <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
          ) : (
            <MailSearch className="h-4 w-4" aria-hidden />
          )}
          {isPending ? "Hole..." : "Jetzt abholen"}
        </button>
      </div>
    </form>
  );
}
