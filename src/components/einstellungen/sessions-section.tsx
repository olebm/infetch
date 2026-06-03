"use client";

import { useActionState, useState } from "react";
import {
  invalidateAllOtherSessionsAction,
  switchOrganizationAction,
  type SessionsState,
} from "@/app/(app)/einstellungen/actions";

const idle: SessionsState = { status: "idle", message: "" };

export function SessionsSection({
  sessionCount,
  lastUsedAt,
}: {
  sessionCount: number;
  lastUsedAt: string | null;
}) {
  const [state, formAction, isPending] = useActionState(invalidateAllOtherSessionsAction, idle);

  // Snapshot `now` once at mount — keeps `fmtRelative` pure during render
  // (react-hooks/purity rule). Trade-off: the "vor X Min" label doesn't
  // refresh while the page stays open; acceptable for a settings screen.
  const [now] = useState(() => Date.now());

  function fmtRelative(iso: string | null): string {
    if (!iso) return "–";
    const diff = now - new Date(iso).getTime();
    const mins = Math.floor(diff / 60_000);
    if (mins < 1) return "gerade eben";
    if (mins < 60) return `vor ${mins} Min.`;
    const hrs = Math.floor(mins / 60);
    if (hrs < 24) return `vor ${hrs} Std.`;
    return `vor ${Math.floor(hrs / 24)} Tagen`;
  }

  const otherCount = Math.max(0, sessionCount - 1);

  return (
    <li className="flex items-center gap-3 py-3">
      <div className="flex-1">
        <div className="text-sm text-ink">Aktive Sitzungen</div>
        <div className="text-xs text-muted">
          {sessionCount} aktiv · zuletzt {fmtRelative(lastUsedAt)}
          {state.status === "success" && <span className="ml-2 text-ok">{state.message}</span>}
          {state.status === "error" && <span className="ml-2 text-danger">{state.message}</span>}
        </div>
      </div>
      {otherCount > 0 && (
        <form action={formAction}>
          <button
            type="submit"
            disabled={isPending}
            className="inline-flex h-7 items-center rounded border border-line px-2.5 text-xs text-ink hover:bg-surface disabled:opacity-50"
          >
            {isPending ? "…" : `${otherCount} abmelden`}
          </button>
        </form>
      )}
      {otherCount === 0 && <span className="text-xs text-muted">nur diese</span>}
    </li>
  );
}

export function SwitchOrgButton({ orgId }: { orgId: string }) {
  const [, formAction, isPending] = useActionState(switchOrganizationAction, idle);
  return (
    <form action={formAction}>
      <input type="hidden" name="orgId" value={orgId} />
      <button
        type="submit"
        disabled={isPending}
        className="inline-flex h-7 items-center rounded border border-line px-2.5 text-xs text-ink hover:bg-surface disabled:opacity-50"
      >
        {isPending ? "…" : "wechseln"}
      </button>
    </form>
  );
}
