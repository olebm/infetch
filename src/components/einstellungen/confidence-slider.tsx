"use client";

import { useActionState, useRef, useState } from "react";
import {
  updateConfidenceThresholdAction,
  type ConfidenceThresholdState,
} from "@/app/(app)/einstellungen/actions";
import { cn } from "@/lib/utils";

const idle: ConfidenceThresholdState = { status: "idle", message: "" };

interface ConfidenceSliderProps {
  initialValue: number; // 0.0–1.0 float
}

export function ConfidenceSlider({ initialValue }: ConfidenceSliderProps) {
  const [state, formAction, isPending] = useActionState(updateConfidenceThresholdAction, idle);
  const [displayValue, setDisplayValue] = useState(Math.round(initialValue * 100));
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const formRef = useRef<HTMLFormElement | null>(null);

  // Sync if server value changed.
  // Uses the "store previous value" pattern instead of an effect
  // (https://react.dev/reference/react/useState#storing-information-from-previous-renders),
  // so React 19's react-hooks/set-state-in-effect rule stays happy.
  const [lastSyncedState, setLastSyncedState] = useState(state);
  if (lastSyncedState !== state) {
    setLastSyncedState(state);
    if (state.status === "success" && state.value !== undefined) {
      setDisplayValue(Math.round(state.value * 100));
    }
  }

  function handleChange(e: React.ChangeEvent<HTMLInputElement>) {
    const pct = Number(e.target.value);
    setDisplayValue(pct);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      formRef.current?.requestSubmit();
    }, 600);
  }

  return (
    <form ref={formRef} action={formAction} className="space-y-3">
      <input type="hidden" name="confidence" value={displayValue / 100} />

      <div className="flex items-center gap-4">
        <input
          type="range"
          min={70}
          max={99}
          step={1}
          value={displayValue}
          onChange={handleChange}
          className="h-1.5 flex-1 cursor-pointer accent-ink"
          aria-label="Empfindlichkeit"
        />
        <span className="w-10 text-right font-mono text-sm font-semibold tabular-nums text-ink">
          {displayValue}%
        </span>
      </div>

      <p className="text-xs text-muted">
        Ist die KI mindestens <strong>{displayValue}%</strong> sicher, versendet sie die Rechnung automatisch — sonst landet sie im Review.
      </p>

      {state.status !== "idle" && (
        <p
          className={cn(
            "text-xs",
            state.status === "error" ? "text-danger" : "text-ok",
          )}
        >
          {isPending ? "Speichere…" : state.message}
        </p>
      )}
    </form>
  );
}
