"use client";

import { useActionState } from "react";
import { Send } from "lucide-react";
import { saveExportTargetAction, type CredentialFormState } from "@/app/(app)/einstellungen/actions";
import type { ExportTargetConfig } from "@/exports/export-pipeline";

const initialState: CredentialFormState = {
  status: "idle",
  message: "Empfänger-E-Mail und SMTP-Postfach konfigurieren.",
};

export function ExportTargetForm({ config }: { config: ExportTargetConfig }) {
  const [state, formAction, isPending] = useActionState(saveExportTargetAction, initialState);

  const statusMessage = state.status !== "idle" ? state.message : initialState.message;
  const messageColor =
    state.status === "success"
      ? "text-ok"
      : state.status === "error"
        ? "text-danger"
        : "text-muted";

  return (
    <form action={formAction} className="rounded border border-line bg-white p-4 shadow-soft">
      <input type="hidden" name="exportTarget" value={config.target} />
      <div className="flex items-start justify-between gap-4">
        <div>
          <h3 className="text-sm font-semibold">{config.label}</h3>
          <p className={`mt-1 text-sm ${messageColor}`}>{statusMessage}</p>
        </div>
        <Send className="h-4 w-4 text-brand" aria-hidden />
      </div>
      <div className="mt-4 grid gap-3 md:grid-cols-2">
        <input
          name="recipientEmail"
          type="email"
          defaultValue={config.recipientEmail ?? ""}
          placeholder="buchhaltung@kontist.com"
          className="rounded border border-line bg-surface px-3 py-2 text-sm md:col-span-2"
        />
        <div>
          <label className="mb-1 block text-xs text-muted">SMTP-Postfach</label>
          <select
            name="smtpSlot"
            defaultValue={config.smtpSlot}
            className="w-full rounded border border-line bg-surface px-3 py-2 text-sm"
          >
            <option value="primary">Postfach 1 (Primary)</option>
            <option value="secondary">Postfach 2 (Secondary)</option>
          </select>
        </div>
        <div className="flex items-end pb-2">
          <label className="inline-flex items-center gap-2 text-sm text-muted">
            <input name="enabled" type="checkbox" defaultChecked={config.enabled} />
            Export aktiviert
          </label>
        </div>
      </div>
      <div className="mt-4 flex justify-end">
        <button
          type="submit"
          disabled={isPending}
          className="rounded bg-brand px-4 py-2 text-sm font-medium text-white disabled:cursor-not-allowed disabled:opacity-60"
        >
          {isPending ? "Speichere..." : "Speichern"}
        </button>
      </div>
    </form>
  );
}
