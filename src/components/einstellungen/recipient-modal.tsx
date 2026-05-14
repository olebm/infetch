"use client";

import { useActionState, useEffect, useState } from "react";
import { saveExportTargetAction, type CredentialFormState } from "@/app/(app)/einstellungen/actions";
import { Modal } from "@/components/ui/modal";
import { VendorLogo } from "@/components/ui/vendor-logo";
import { cn } from "@/lib/utils";
import { Plus } from "lucide-react";

type TargetSlot = "kontist" | "accountable";

interface Recipient {
  key: string;
  label: string;
  domain: string | null; // null = no reliable logo, show text-only chip
  email: string;
  slot: TargetSlot;
  hint?: string;
}

const RECIPIENTS: Recipient[] = [
  {
    key: "accountable",
    label: "Accountable",
    domain: "accountable.eu",
    email: "expenses@accountable.eu",
    slot: "accountable",
    hint: "Für Ausgangsrechnungen (Einnahmen) stattdessen revenue@accountable.eu verwenden.",
  },
  {
    key: "billomat",
    label: "Billomat",
    domain: "billomat.com",
    email: "",
    slot: "kontist",
    hint: "Deine persönliche Adresse findest du in Billomat unter Einstellungen → Posteingang.",
  },
  {
    key: "buchhaltungsbutler",
    label: "BuchhaltungsButler",
    domain: null, // no logo on Brandfetch
    email: "",
    slot: "kontist",
    hint: "Deine persönliche Adresse (Format: eingang.Name@belege.buchhaltungsbutler.de) findest du in deinen Kontoeinstellungen.",
  },
  {
    key: "datev",
    label: "DATEV",
    domain: "datev.de",
    email: "",
    slot: "kontist",
    hint: "Die Empfängeradresse wird von DATEV pro Belegtyp generiert. Du erhältst sie von deinem Steuerberater oder in DATEV Belege online.",
  },
  {
    key: "fastbill",
    label: "FastBill",
    domain: "fastbill.com",
    email: "",
    slot: "kontist",
    hint: "Deine persönliche Adresse findest du in FastBill unter Einstellungen → Übersicht. Ab Pro-Tarif verfügbar.",
  },
  {
    key: "kontist",
    label: "Kontist",
    domain: "kontist.dev",
    email: "belege@kontist.com",
    slot: "kontist",
  },
  {
    key: "lexoffice",
    label: "Lexoffice",
    domain: "lexoffice.de",
    email: "",
    slot: "kontist",
    hint: "Deine persönliche Adresse (Format: name@inbox.lexware.email) findest du in Lexoffice unter Einstellungen → Belegempfang. Erfordert XL-Tarif.",
  },
  {
    key: "papierkram",
    label: "Papierkram",
    domain: null, // no logo on Brandfetch
    email: "",
    slot: "kontist",
    hint: 'Deine persönliche Adresse findest du in Papierkram unter Übersicht → Posteingang → "E-Mail empfangen".',
  },
  {
    key: "sevdesk",
    label: "sevDesk",
    domain: "sevdesk.de",
    email: "autobox@sevdesk.email",
    slot: "kontist",
  },
];

const idle: CredentialFormState = { status: "idle", message: "" };

interface RecipientModalProps {
  open: boolean;
  onClose: () => void;
}

export function RecipientModal({ open, onClose }: RecipientModalProps) {
  const [state, formAction, isPending] = useActionState(saveExportTargetAction, idle);
  const [selected, setSelected] = useState<Recipient | null>(null);
  const [email, setEmail] = useState("");
  const [slot, setSlot] = useState<TargetSlot>("kontist");

  const needsManualEmail = selected !== null && !selected.email;

  useEffect(() => {
    if (state.status === "success") onClose();
  }, [state.status, onClose]);

  useEffect(() => {
    if (open) {
      setSelected(null);
      setEmail("");
      setSlot("kontist");
    }
  }, [open]);

  function pick(r: Recipient) {
    setSelected(r);
    setEmail(r.email);
    setSlot(r.slot);
  }

  return (
    <Modal open={open} onClose={onClose} title="Empfänger konfigurieren" size="md">
      <form action={formAction} className="space-y-5">
        <input type="hidden" name="exportTarget" value={slot} />
        <input type="hidden" name="smtpSlot" value="primary" />
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
              <label htmlFor="recipient-slot" className="mb-1 block text-xs font-medium text-muted">Empfänger-Slot</label>
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
                <p className="mt-1.5 text-xs text-muted">{selected.hint}</p>
              )}
            </div>
          </div>
        )}

        {state.status === "error" && (
          <p className="text-xs text-danger">{state.message}</p>
        )}

        <div className="flex items-center justify-end gap-2 pt-1">
          <button type="button" onClick={onClose} className="rounded px-4 py-2 text-sm text-muted hover:bg-surface">
            Abbrechen
          </button>
          <button
            type="submit"
            disabled={isPending || !selected}
            className={cn("rounded bg-brand px-4 py-2 text-sm font-medium text-white", "disabled:cursor-not-allowed disabled:opacity-60")}
          >
            {isPending ? "Speichere…" : "Empfänger speichern"}
          </button>
        </div>
      </form>
    </Modal>
  );
}

export function AddRecipientButton() {
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
      <RecipientModal open={open} onClose={() => setOpen(false)} />
    </>
  );
}
