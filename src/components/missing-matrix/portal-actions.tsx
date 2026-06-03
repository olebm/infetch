"use client";

import { useActionState } from "react";
import { Search } from "lucide-react";
import { runVendorRequiredPortalAction, type PortalActionState } from "@/app/(app)/fehlt/actions";

const initialVendorState: PortalActionState = {
  status: "idle",
  message: "",
};

export function RunVendorPortalForm({ vendorKey }: { vendorKey: string }) {
  const [state, formAction, isPending] = useActionState(
    runVendorRequiredPortalAction,
    initialVendorState,
  );

  return (
    <form action={formAction}>
      <input type="hidden" name="vendorKey" value={vendorKey} />
      <div className="flex flex-col items-end gap-1">
        <button
          type="submit"
          disabled={isPending}
          className="inline-flex h-8 items-center gap-1.5 rounded border border-line bg-white px-3 text-xs text-ink hover:bg-surface disabled:cursor-not-allowed disabled:opacity-60"
        >
          <Search className="h-3 w-3" aria-hidden />
          {isPending ? "Hole…" : "Online holen"}
        </button>
        {state.message && (
          <div className={`text-[11px] ${state.status === "error" ? "text-danger" : "text-muted"}`}>
            {state.message}
          </div>
        )}
      </div>
    </form>
  );
}
