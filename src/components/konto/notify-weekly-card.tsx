"use client";

import { useActionState, useOptimistic } from "react";
import { updateNotifyWeeklyAction } from "@/app/(app)/konto/actions";
import type { MemberActionState } from "@/app/(app)/konto/actions";

const idle: MemberActionState = { status: "idle", message: "" };

export function NotifyWeeklyCard({ initialValue }: { initialValue: boolean }) {
  const [state, formAction, isPending] = useActionState(updateNotifyWeeklyAction, idle);
  const [optimisticValue, setOptimisticValue] = useOptimistic(initialValue);

  return (
    <div className="flex items-start justify-between gap-4">
      <div>
        <div className="text-sm font-medium text-ink">Wöchentliche Zusammenfassung</div>
        <div className="mt-0.5 text-xs text-muted">
          Jeden Montag per E-Mail: Rechnungen der letzten Woche auf einen Blick.
        </div>
        {state.status === "error" && (
          <div className="mt-1.5 text-xs text-danger">{state.message}</div>
        )}
      </div>
      <form
        action={async (fd: FormData) => {
          const next = !optimisticValue;
          setOptimisticValue(next);
          fd.set("notifyWeekly", String(next));
          await formAction(fd);
        }}
      >
        <button
          type="submit"
          disabled={isPending}
          aria-label={
            optimisticValue
              ? "Wöchentliche Zusammenfassung deaktivieren"
              : "Wöchentliche Zusammenfassung aktivieren"
          }
          className={`
            relative inline-flex h-5 w-9 shrink-0 cursor-pointer items-center rounded-full border-2 border-transparent
            transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ink focus-visible:ring-offset-2
            disabled:cursor-not-allowed disabled:opacity-50
            ${optimisticValue ? "bg-ok" : "bg-line"}
          `}
        >
          <span
            className={`
              pointer-events-none inline-block h-4 w-4 rounded-full bg-white shadow-sm
              transition-transform
              ${optimisticValue ? "translate-x-4" : "translate-x-0"}
            `}
          />
        </button>
      </form>
    </div>
  );
}
