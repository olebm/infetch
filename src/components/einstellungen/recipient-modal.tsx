"use client";

import { useActionState, useEffect, useState } from "react";
import { saveExportTargetAction, type CredentialFormState } from "@/app/(app)/einstellungen/actions";
import { Modal } from "@/components/ui/modal";
import { VendorLogo } from "@/components/ui/vendor-logo";
import { cn } from "@/lib/utils";
import { Info, Plus } from "lucide-react";
import { RECIPIENTS, type Recipient, type TargetSlot, type SmtpAccountOption } from "@/lib/recipients";

const idle: CredentialFormState = { status: "idle", message: "" };

interface RecipientModalProps {
  open: boolean;
  onClose: () => void;
  smtpOptions?: SmtpAccountOption[];
}

export function RecipientModal({ open, onClose, smtpOptions = [] }: RecipientModalProps) {
  // Form + useActionState liegen in der Kind-Komponente, die nur bei open
  // gemountet wird (Modal gibt sonst null zurück). So startet der Action-State
  // bei jedem Öffnen frisch — sonst klebt status="success" und der Auto-Close-
  // Effekt würde das Modal beim Wiederöffnen sofort schließen.
  return (
    <Modal open={open} onClose={onClose} title="Empfänger konfigurieren" size="md">
      <RecipientForm onClose={onClose} smtpOptions={smtpOptions} />
    </Modal>
  );
}

function RecipientForm({ onClose, smtpOptions }: { onClose: () => void; smtpOptions: SmtpAccountOption[] }) {
  const [state, formAction, isPending] = useActionState(saveExportTargetAction, idle);
  const [selected, setSelected] = useState<Recipient | null>(null);
  const [email, setEmail] = useState("");
  const [slot, setSlot] = useState<TargetSlot>("kontist");
  const [smtpSlot, setSmtpSlot] = useState<"primary" | "secondary">("primary");

  const needsManualEmail = selected !== null && !selected.email;

  useEffect(() => {
    if (state.status === "success") onClose();
  }, [state.status, onClose]);

  function pick(r: Recipient) {
    setSelected(r);
    setEmail(r.email);
    setSlot(r.slot);
  }

  return (
      <form action={formAction} className="space-y-5">
        <input type="hidden" name="exportTarget" value={slot} />
        <input type="hidden" name="smtpSlot" value={smtpSlot} />
        <input type="hidden" name="enabled" value="on" />
        {/* recipientEmail for fixed-address providers */}
        {selected && !needsManualEmail && (
          <input type="hidden" name="recipientEmail" value={email} />
        )}

        {/* Provider grid */}
        <div>
          <p className="mb-3 text-xs text-muted">
            Software wählen — bekannte Adressen werden automatisch eingetragen:
          </p>
          <div className="grid grid-cols-3 gap-2 sm:grid-cols-4">
            {RECIPIENTS.map((r) => {
              const isActive = selected?.key === r.key;
              return (
                <button
                  key={r.key}
                  type="button"
                  onClick={() => pick(r)}
                  className={cn(
                    "flex flex-col items-center gap-2 rounded-md border p-3 text-center transition-colors",
                    isActive
                      ? "border-brand bg-brand/5"
                      : "border-line bg-paper hover:border-brand/50 hover:bg-surface",
                  )}
                >
                  {r.domain ? (
                    <VendorLogo domain={r.domain} name={r.label} size={28} />
                  ) : (
                    <div
                      className="flex shrink-0 items-center justify-center rounded-full font-medium"
                      style={{ width: 28, height: 28, background: "#dbd8d0", color: "#151a22", fontSize: 12 }}
                    >
                      {r.label[0]}
                    </div>
                  )}
                  <span className={cn("text-[11px]", isActive ? "font-medium text-brand" : "text-muted")}>
                    {r.label}
                  </span>
                </button>
              );
            })}
            {/* Custom */}
            <button
              type="button"
              onClick={() => pick({ key: "custom", label: "Eigener", domain: null, email: "", slot: "kontist" })}
              className={cn(
                "flex flex-col items-center gap-2 rounded-md border p-3 text-center transition-colors",
                selected?.key === "custom"
                  ? "border-brand bg-brand/5"
                  : "border-dashed border-line bg-paper hover:border-brand/50 hover:bg-surface",
              )}
            >
              <div className="flex h-7 w-7 items-center justify-center rounded border border-line bg-surface text-sm text-muted">
                +
              </div>
              <span className="text-[11px] text-muted">Eigener</span>
            </button>
          </div>
        </div>

        {/* Manual email entry — only shown when provider has no known fixed address */}
        {needsManualEmail && (
          <div className="space-y-4">
            <div>
              {/* A11Y (INFETCH-104): htmlFor verknüpft Label mit Select */}
              <label htmlFor="recipient-slot" className="mb-1 block text-xs font-medium text-muted">Empfänger-Platz</label>
              <select
                id="recipient-slot"
                value={slot}
                onChange={(e) => setSlot(e.target.value as TargetSlot)}
                className="w-full rounded border border-line bg-surface px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-brand"
              >
                <option value="kontist">Primärer Empfänger</option>
                <option value="accountable">Sekundärer Empfänger</option>
              </select>
            </div>
            <div>
              <label htmlFor="recipient-email" className="mb-1 block text-xs font-medium text-muted">E-Mail-Adresse</label>
              <input
                id="recipient-email"
                name="recipientEmail"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="buchhaltung@beispiel.de"
                required
                autoFocus
                className="w-full rounded border border-line bg-white px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-brand"
              />
              {selected?.hint && (
                <div className="mt-2 flex items-start gap-2 rounded border border-line bg-surface px-3 py-2 text-xs text-muted">
                  <Info size={13} className="mt-0.5 shrink-0 text-muted" aria-hidden />
                  <span>{selected.hint}</span>
                </div>
              )}
            </div>
          </div>
        )}

        {smtpOptions.length > 1 && (
          <div>
            <label htmlFor="recipient-smtp" className="mb-1 block text-xs font-medium text-muted">Absende-Konto</label>
            <select
              id="recipient-smtp"
              value={smtpSlot}
              onChange={(e) => setSmtpSlot(e.target.value as "primary" | "secondary")}
              className="w-full rounded border border-line bg-surface px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-brand"
            >
              {smtpOptions.map((o, i) => (
                <option key={o.slot} value={o.slot}>
                  {o.fromAddress}{i === 0 ? " (Standard)" : ""}
                </option>
              ))}
            </select>
            <p className="mt-1 text-[11px] text-muted">
              Von dieser Adresse wird an diesen Empfänger gesendet.
            </p>
          </div>
        )}

        {state.status === "error" && (
          <p className="text-xs text-danger">{state.message}</p>
        )}

        <div className="flex items-center justify-end gap-2 pt-1">
          <button type="button" onClick={onClose} className="rounded px-4 py-2.5 text-sm text-muted hover:bg-surface">
            Abbrechen
          </button>
          <button
            type="submit"
            disabled={isPending || !selected}
            className={cn("rounded bg-brand px-4 py-2.5 text-sm font-medium text-white", "disabled:cursor-not-allowed disabled:opacity-60")}
          >
            {isPending ? "Speichere…" : "Empfänger speichern"}
          </button>
        </div>
      </form>
  );
}

export function AddRecipientButton({ smtpOptions = [] }: { smtpOptions?: SmtpAccountOption[] }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="inline-flex items-center gap-1.5 rounded border border-line bg-paper px-3 py-1.5 text-xs font-medium text-ink hover:bg-surface"
      >
        <Plus className="h-3.5 w-3.5" aria-hidden />
        Empfänger konfigurieren
      </button>
      <RecipientModal open={open} onClose={() => setOpen(false)} smtpOptions={smtpOptions} />
    </>
  );
}

// ── Edit existing recipient ─────────────────────────────────────────────────

export interface EditRecipientTarget {
  target: string;
  label: string;
  recipientEmail: string | null;
  smtpSlot: "primary" | "secondary";
  enabled: boolean;
}

function EditRecipientModal({
  open,
  onClose,
  target,
  smtpOptions,
}: {
  open: boolean;
  onClose: () => void;
  target: EditRecipientTarget;
  smtpOptions: SmtpAccountOption[];
}) {
  // Form + State in der Kind-Komponente: nur bei open gemountet → frischer
  // Action-State pro Öffnung (verhindert sticky status="success", der das Modal
  // beim Wiederöffnen sofort schließen würde).
  return (
    <Modal open={open} onClose={onClose} title={`${target.label} bearbeiten`} size="md">
      <EditRecipientForm onClose={onClose} target={target} smtpOptions={smtpOptions} />
    </Modal>
  );
}

function EditRecipientForm({
  onClose,
  target,
  smtpOptions,
}: {
  onClose: () => void;
  target: EditRecipientTarget;
  smtpOptions: SmtpAccountOption[];
}) {
  const [state, formAction, isPending] = useActionState(saveExportTargetAction, idle);
  const [email, setEmail] = useState(target.recipientEmail ?? "");
  const [smtpSlot, setSmtpSlot] = useState<"primary" | "secondary">(target.smtpSlot);

  useEffect(() => {
    if (state.status === "success") onClose();
  }, [state.status, onClose]);

  return (
      <form action={formAction} className="space-y-5">
        <input type="hidden" name="exportTarget" value={target.target} />
        <input type="hidden" name="smtpSlot" value={smtpSlot} />
        <input type="hidden" name="enabled" value="on" />

        <div>
          <label htmlFor="edit-recipient-email" className="mb-1 block text-xs font-medium text-muted">E-Mail-Adresse</label>
          <input
            id="edit-recipient-email"
            name="recipientEmail"
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="buchhaltung@beispiel.de"
            required
            className="w-full rounded border border-line bg-white px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-brand"
          />
        </div>

        {smtpOptions.length > 1 && (
          <div>
            <label htmlFor="edit-recipient-smtp" className="mb-1 block text-xs font-medium text-muted">Absende-Konto</label>
            <select
              id="edit-recipient-smtp"
              value={smtpSlot}
              onChange={(e) => setSmtpSlot(e.target.value as "primary" | "secondary")}
              className="w-full rounded border border-line bg-surface px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-brand"
            >
              {smtpOptions.map((o, i) => (
                <option key={o.slot} value={o.slot}>
                  {o.fromAddress}{i === 0 ? " (Standard)" : ""}
                </option>
              ))}
            </select>
            <p className="mt-1 text-[11px] text-muted">Von dieser Adresse wird an diesen Empfänger gesendet.</p>
          </div>
        )}

        {state.status === "error" && <p className="text-xs text-danger">{state.message}</p>}

        <div className="flex items-center justify-end gap-2 pt-1">
          <button type="button" onClick={onClose} className="rounded px-4 py-2.5 text-sm text-muted hover:bg-surface">
            Abbrechen
          </button>
          <button
            type="submit"
            disabled={isPending}
            className={cn("rounded bg-brand px-4 py-2.5 text-sm font-medium text-white", "disabled:cursor-not-allowed disabled:opacity-60")}
          >
            {isPending ? "Speichere…" : "Speichern"}
          </button>
        </div>
      </form>
  );
}

export function EditRecipientButton({
  target,
  smtpOptions = [],
}: {
  target: EditRecipientTarget;
  smtpOptions?: SmtpAccountOption[];
}) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="text-xs text-muted underline underline-offset-4 decoration-line hover:text-ink"
      >
        bearbeiten
      </button>
      <EditRecipientModal open={open} onClose={() => setOpen(false)} target={target} smtpOptions={smtpOptions} />
    </>
  );
}
