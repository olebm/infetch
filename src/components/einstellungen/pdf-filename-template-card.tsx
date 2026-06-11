"use client";

import { useActionState, useState } from "react";
import {
  updatePdfFilenameTemplateAction,
  type SubjectTemplateState,
} from "@/app/(app)/einstellungen/actions";
import {
  SUBJECT_VARIABLES,
  DEFAULT_PDF_FILENAME_TEMPLATE,
  renderPdfFilenameTemplate,
} from "@/lib/recipients";
import { cn } from "@/lib/utils";

const idle: SubjectTemplateState = { status: "idle", message: "" };

interface PdfFilenameTemplateCardProps {
  initialValue: string; // "" means "use built-in default"
}

export function PdfFilenameTemplateCard({ initialValue }: PdfFilenameTemplateCardProps) {
  const [state, formAction, isPending] = useActionState(updatePdfFilenameTemplateAction, idle);
  const [value, setValue] = useState(initialValue || DEFAULT_PDF_FILENAME_TEMPLATE);

  // Sync if the server confirmed a new value.
  const [lastState, setLastState] = useState(state);
  if (lastState !== state) {
    setLastState(state);
    if (state.status === "success" && state.value !== undefined) {
      setValue(state.value || DEFAULT_PDF_FILENAME_TEMPLATE);
    }
  }

  const preview = renderPdfFilenameTemplate(value || DEFAULT_PDF_FILENAME_TEMPLATE, {
    vendor: SUBJECT_VARIABLES[0].sample,
    date: SUBJECT_VARIABLES[1].sample,
    amount: SUBJECT_VARIABLES[2].sample,
  });

  return (
    <form action={formAction} className="space-y-3">
      <div className="flex items-baseline justify-between">
        <label htmlFor="pdf-filename-template" className="text-xs font-medium text-muted">
          Dateiname-Schema für weitergeleitete Rechnungen
        </label>
        <button
          type="button"
          onClick={() => setValue(DEFAULT_PDF_FILENAME_TEMPLATE)}
          className="text-[11px] text-muted hover:text-ink"
        >
          zurücksetzen
        </button>
      </div>

      <input
        id="pdf-filename-template"
        name="pdfFilenameTemplate"
        type="text"
        value={value}
        onChange={(e) => setValue(e.target.value)}
        placeholder={DEFAULT_PDF_FILENAME_TEMPLATE}
        maxLength={200}
        className="h-9 w-full rounded border border-line bg-surface px-3 font-mono text-sm outline-none focus:border-brand focus:ring-2 focus:ring-brand/20"
      />

      <div className="flex flex-wrap items-center gap-1.5">
        <span className="text-[11px] text-muted">Baustein einfügen:</span>
        {SUBJECT_VARIABLES.map((v) => (
          <button
            key={v.token}
            type="button"
            onClick={() =>
              setValue((s) => {
                // Insert before .pdf if template ends with it, otherwise append
                const withoutExt = s.replace(/\.pdf$/i, "");
                const sep = withoutExt && !withoutExt.endsWith("_") ? "_" : "";
                return `${withoutExt}${sep}${v.token}.pdf`;
              })
            }
            className="inline-flex items-center gap-1 rounded-full border border-line bg-white px-2.5 py-0.5 text-[11px] text-ink hover:border-brand hover:text-brand transition-colors"
            title={`${v.label} einfügen (${v.token})`}
          >
            <span className="text-[9px] text-muted">+</span>
            {v.label}
          </button>
        ))}
      </div>

      <div className="rounded-md border border-line bg-surface px-3 py-2.5">
        <div className="text-[11px] text-muted">Vorschau</div>
        <div className="mt-0.5 truncate font-mono text-sm font-medium text-ink">{preview}</div>
      </div>

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
