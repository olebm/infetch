"use client";

import { useActionState, useState } from "react";
import {
  updateInvoiceSubjectTemplateAction,
  type SubjectTemplateState,
} from "@/app/(app)/einstellungen/actions";
import {
  SUBJECT_VARIABLES,
  DEFAULT_SUBJECT_TEMPLATE,
  renderSubjectTemplate,
} from "@/lib/recipients";
import { cn } from "@/lib/utils";

const idle: SubjectTemplateState = { status: "idle", message: "" };

interface SubjectTemplateCardProps {
  initialValue: string; // "" means "use built-in default"
}

export function SubjectTemplateCard({ initialValue }: SubjectTemplateCardProps) {
  const [state, formAction, isPending] = useActionState(updateInvoiceSubjectTemplateAction, idle);
  const [value, setValue] = useState(initialValue || DEFAULT_SUBJECT_TEMPLATE);

  // Sync if the server confirmed a new value. "Store previous value" pattern
  // instead of an effect, per the react-hooks/set-state-in-effect rule.
  const [lastState, setLastState] = useState(state);
  if (lastState !== state) {
    setLastState(state);
    if (state.status === "success" && state.value !== undefined) {
      setValue(state.value || DEFAULT_SUBJECT_TEMPLATE);
    }
  }

  const preview = renderSubjectTemplate(value || DEFAULT_SUBJECT_TEMPLATE, {
    vendor: SUBJECT_VARIABLES[0].sample,
    date: SUBJECT_VARIABLES[1].sample,
    amount: SUBJECT_VARIABLES[2].sample,
  });

  return (
    <form action={formAction} className="space-y-3">
      <div className="flex items-baseline justify-between">
        <label htmlFor="subject-template" className="text-xs font-medium text-muted">
          Betreff-Schema für weitergeleitete Rechnungen
        </label>
        <button
          type="button"
          onClick={() => setValue(DEFAULT_SUBJECT_TEMPLATE)}
          className="text-[11px] text-muted hover:text-ink"
        >
          zurücksetzen
        </button>
      </div>

      <input
        id="subject-template"
        name="subjectTemplate"
        type="text"
        value={value}
        onChange={(e) => setValue(e.target.value)}
        placeholder={DEFAULT_SUBJECT_TEMPLATE}
        maxLength={200}
        className="h-9 w-full rounded border border-line bg-surface px-3 font-mono text-sm outline-none focus:border-brand focus:ring-2 focus:ring-brand/20"
      />

      <div className="flex flex-wrap items-center gap-1.5">
        <span className="text-[11px] text-muted">Bausteine:</span>
        {SUBJECT_VARIABLES.map((v) => (
          <button
            key={v.token}
            type="button"
            onClick={() =>
              setValue((s) => `${s}${s && !s.endsWith(" ") ? " " : ""}${v.token}`)
            }
            className="rounded border border-line bg-white px-1.5 py-0.5 font-mono text-[11px] text-ink hover:border-brand hover:text-brand transition-colors"
            title={`${v.label} einfügen`}
          >
            {v.token}
          </button>
        ))}
      </div>

      <p className="text-xs text-muted">
        Vorschau: <span className="font-medium text-ink">{preview}</span>
      </p>

      <div className="flex items-center gap-3">
        <button
          type="submit"
          disabled={isPending}
          className="inline-flex h-8 items-center rounded bg-brand px-3 text-xs font-medium text-white disabled:cursor-not-allowed disabled:opacity-50"
        >
          {isPending ? "Speichere…" : "Speichern"}
        </button>
        {state.status !== "idle" && !isPending && (
          <span className={cn("text-xs", state.status === "error" ? "text-danger" : "text-ok")}>
            {state.message}
          </span>
        )}
      </div>
    </form>
  );
}
