"use client";

import { useActionState, useState } from "react";
import { Trash2, Plus, X } from "lucide-react";
import {
  saveAutoApprovalRuleAction,
  deleteAutoApprovalRuleAction,
  type AutoApprovalRuleFormState,
} from "@/app/(app)/einstellungen/actions";

const idle: AutoApprovalRuleFormState = { status: "idle", message: "" };

export type AutoApprovalRuleRow = {
  id: number;
  vendorId: number | null;
  vendorPattern: string | null;
  maxAmountCents: number | null;
  enabled: boolean;
  vendorName: string | null;
};

export type VendorOption = { id: number; name: string };

export function AutoApprovalRulesPanel({
  rules,
  vendors,
}: {
  rules: AutoApprovalRuleRow[];
  vendors: VendorOption[];
}) {
  const [editing, setEditing] = useState<AutoApprovalRuleRow | "new" | null>(null);

  return (
    <div className="space-y-3">
      {rules.length === 0 ? (
        <div className="rounded border border-dashed border-line bg-surface px-4 py-6 text-center text-sm text-muted">
          Noch keine Auto-Approval-Regeln. Lege eine an, damit sichere Rechnungen automatisch durchgewunken werden.
        </div>
      ) : (
        <div className="overflow-hidden rounded border border-line bg-white">
          <table className="w-full text-sm">
            <thead className="bg-surface text-xs text-muted">
              <tr>
                <th className="px-3 py-2 text-left">Lieferant / Pattern</th>
                <th className="px-3 py-2 text-left">Max. Betrag</th>
                <th className="px-3 py-2 text-left">Status</th>
                <th className="px-3 py-2 text-right">Aktion</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {rules.map((rule) => (
                <tr key={rule.id}>
                  <td className="px-3 py-2">
                    {rule.vendorName ?? (
                      <span className="text-muted">
                        Pattern: <code className="font-mono">{rule.vendorPattern}</code>
                      </span>
                    )}
                  </td>
                  <td className="px-3 py-2">
                    {rule.maxAmountCents === null
                      ? <span className="text-muted">unbegrenzt</span>
                      : `${(rule.maxAmountCents / 100).toFixed(2)} €`}
                  </td>
                  <td className="px-3 py-2">
                    {rule.enabled ? (
                      <span className="rounded bg-ok-soft px-1.5 py-0.5 text-xs text-ok">aktiv</span>
                    ) : (
                      <span className="rounded bg-slate-50 px-1.5 py-0.5 text-xs text-slate-600">pausiert</span>
                    )}
                  </td>
                  <td className="px-3 py-2 text-right">
                    <button
                      type="button"
                      onClick={() => setEditing(rule)}
                      className="mr-2 text-xs text-muted hover:text-brand"
                    >
                      Bearbeiten
                    </button>
                    <DeleteRuleButton ruleId={rule.id} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {editing === null && (
        <button
          type="button"
          onClick={() => setEditing("new")}
          className="inline-flex items-center gap-1.5 rounded border border-line bg-white px-3 py-2 text-sm font-medium text-ink hover:border-brand/40"
        >
          <Plus className="h-3.5 w-3.5" aria-hidden />
          Regel hinzufügen
        </button>
      )}

      {editing !== null && (
        <RuleEditor
          existing={editing === "new" ? null : editing}
          vendors={vendors}
          onClose={() => setEditing(null)}
        />
      )}
    </div>
  );
}

function RuleEditor({
  existing,
  vendors,
  onClose,
}: {
  existing: AutoApprovalRuleRow | null;
  vendors: VendorOption[];
  onClose: () => void;
}) {
  const [state, formAction, isPending] = useActionState(saveAutoApprovalRuleAction, idle);
  const [mode, setMode] = useState<"vendor" | "pattern">(
    existing?.vendorPattern && !existing.vendorId ? "pattern" : "vendor",
  );

  if (state.status === "success") {
    // Close on success; revalidatePath bringt frische Liste
    setTimeout(onClose, 100);
  }

  return (
    <div className="rounded border border-brand/30 bg-white p-4 shadow-soft">
      <div className="mb-3 flex items-center justify-between">
        <h3 className="text-sm font-semibold">
          {existing ? "Regel bearbeiten" : "Neue Regel"}
        </h3>
        <button type="button" onClick={onClose} className="text-muted hover:text-ink" aria-label="Abbrechen">
          <X className="h-4 w-4" aria-hidden />
        </button>
      </div>
      <form action={formAction} className="space-y-3">
        {existing && <input type="hidden" name="id" value={existing.id} />}

        <div className="flex gap-2 text-xs">
          <button
            type="button"
            onClick={() => setMode("vendor")}
            className={`rounded border px-2 py-1 ${mode === "vendor" ? "border-brand bg-brand/10 text-brand" : "border-line text-muted"}`}
          >
            Lieferant wählen
          </button>
          <button
            type="button"
            onClick={() => setMode("pattern")}
            className={`rounded border px-2 py-1 ${mode === "pattern" ? "border-brand bg-brand/10 text-brand" : "border-line text-muted"}`}
          >
            Pattern (Text-Match)
          </button>
        </div>

        {mode === "vendor" ? (
          <div>
            {/* A11Y (INFETCH-104): htmlFor verknüpft Label mit Select */}
            <label htmlFor="aa-vendorId" className="mb-1 block text-xs text-muted">Lieferant</label>
            <select
              id="aa-vendorId"
              name="vendorId"
              defaultValue={existing?.vendorId ?? ""}
              className="w-full rounded border border-line bg-white px-3 py-2 text-sm"
            >
              <option value="">— bitte wählen —</option>
              {vendors.map((v) => (
                <option key={v.id} value={v.id}>{v.name}</option>
              ))}
            </select>
            <input type="hidden" name="vendorPattern" value="" />
          </div>
        ) : (
          <div>
            <label htmlFor="aa-vendorPattern" className="mb-1 block text-xs text-muted">
              Pattern (Vendor-Name enthält)
            </label>
            <input
              id="aa-vendorPattern"
              name="vendorPattern"
              type="text"
              defaultValue={existing?.vendorPattern ?? ""}
              placeholder="z. B. Hetzner, Adobe, Stripe"
              className="w-full rounded border border-line bg-white px-3 py-2 text-sm"
            />
            <input type="hidden" name="vendorId" value="" />
          </div>
        )}

        <div>
          <label htmlFor="aa-maxAmount" className="mb-1 block text-xs text-muted">
            Maximal-Betrag (€, leer = unbegrenzt)
          </label>
          <input
            id="aa-maxAmount"
            name="maxAmount"
            type="text"
            inputMode="decimal"
            defaultValue={
              existing?.maxAmountCents !== null && existing?.maxAmountCents !== undefined
                ? (existing.maxAmountCents / 100).toFixed(2)
                : ""
            }
            placeholder="50.00"
            className="w-full rounded border border-line bg-white px-3 py-2 text-sm"
          />
          <p className="mt-1 text-xs text-muted">
            Auto-Approval greift nur, wenn der Rechnungs-Betrag &le; dieser Grenze.
          </p>
        </div>

        <div className="flex items-center gap-2">
          <input
            type="checkbox"
            id="auto-approval-enabled"
            name="enabled"
            value="true"
            defaultChecked={existing?.enabled ?? true}
          />
          <label htmlFor="auto-approval-enabled" className="text-sm">
            Regel aktiv
          </label>
        </div>

        {/* A11Y (INFETCH-105): role="alert" kündigt Fehler sofort an, polite für Erfolg */}
        {state.message && (
          <div
            role={state.status === "error" ? "alert" : "status"}
            aria-live={state.status === "error" ? "assertive" : "polite"}
            aria-atomic="true"
            className={`rounded border px-3 py-2 text-xs ${
              state.status === "error"
                ? "border-danger/30 bg-danger-soft text-danger"
                : "border-ok/30 bg-ok-soft text-ok"
            }`}
          >
            {state.message}
          </div>
        )}

        <div className="flex gap-2">
          <button
            type="submit"
            disabled={isPending}
            className="rounded bg-brand px-3 py-2 text-sm font-medium text-white hover:brightness-110 disabled:opacity-50"
          >
            {existing ? "Speichern" : "Hinzufügen"}
          </button>
          <button
            type="button"
            onClick={onClose}
            className="rounded border border-line bg-white px-3 py-2 text-sm font-medium"
          >
            Abbrechen
          </button>
        </div>
      </form>
    </div>
  );
}

function DeleteRuleButton({ ruleId }: { ruleId: number }) {
  const [state, formAction, isPending] = useActionState(deleteAutoApprovalRuleAction, idle);
  void state;
  return (
    <form action={formAction} className="inline">
      <input type="hidden" name="id" value={ruleId} />
      <button
        type="submit"
        disabled={isPending}
        className="text-xs text-muted hover:text-danger disabled:opacity-50"
        aria-label="Regel entfernen"
        title="Regel entfernen"
      >
        <Trash2 className="h-3.5 w-3.5" aria-hidden />
      </button>
    </form>
  );
}
