"use client";

import { useActionState, useState } from "react";
import { CheckCircle2 } from "lucide-react";
import { Modal } from "@/components/ui/modal";
import { useSupportModal } from "@/components/support/support-provider";
import {
  submitSupportRequestAction,
  type SupportCategory,
} from "@/app/(app)/support/actions";

// ── Categories ────────────────────────────────────────────────────────────────

const CATEGORIES: {
  key: SupportCategory;
  label: string;
}[] = [
  { key: "invoice_not_recognized", label: "Rechnung nicht erkannt" },
  { key: "mail_connection",        label: "Mail-Verbindung gestört" },
  { key: "export_problem",         label: "Export-Problem" },
  { key: "account",                label: "Konto & Zugang" },
  { key: "feature_request",        label: "Feature-Wunsch" },
  { key: "other",                  label: "Sonstiges" },
];

const PLACEHOLDERS: Record<SupportCategory, string> = {
  invoice_not_recognized: 'Z.B.: "Von Shopify kommt eine Rechnung, der Anbieter wird als Unknown erkannt und der Betrag fehlt."',
  mail_connection:        'Z.B.: "Seit gestern werden keine neuen Mails abgeholt. Die Verbindung bricht nach 30 Sekunden ab."',
  export_problem:         'Z.B.: "Lexoffice gibt Fehler 403 zurueck, obwohl der API-Key neu gesetzt wurde."',
  account:                'Z.B.: "Ich habe ein Mitglied eingeladen, aber die Person sieht die Organisation nicht."',
  feature_request:        'Z.B.: "Ich wuerde mir wuenschen, dass Rechnungen per Drag & Drop hochgeladen werden koennen."',
  other:                  "Beschreib kurz, womit wir dir helfen koennen.",
};

// ── Modal ─────────────────────────────────────────────────────────────────────

export function SupportModal({ userEmail }: { userEmail?: string }) {
  const { isOpen, close } = useSupportModal();
  const [category, setCategory] = useState<SupportCategory | null>(null);
  const [state, formAction, isPending] = useActionState(submitSupportRequestAction, {
    status: "idle" as const,
    message: "",
  });

  // Reset form state when modal is closed and reopened.
  // Uses the "store previous value" pattern
  // (https://react.dev/reference/react/useState#storing-information-from-previous-renders)
  // instead of an effect, per the react-hooks/set-state-in-effect rule.
  const [prevIsOpen, setPrevIsOpen] = useState(isOpen);
  if (prevIsOpen !== isOpen) {
    setPrevIsOpen(isOpen);
    if (isOpen) setCategory(null);
  }

  return (
    <Modal open={isOpen} onClose={close} title="Wie können wir helfen?" size="sm">
      {state.status === "success" ? (
        <div className="flex flex-col items-center gap-4 py-6 text-center">
          <div className="flex h-12 w-12 items-center justify-center rounded-full bg-ok/10 text-ok">
            <CheckCircle2 size={24} aria-hidden />
          </div>
          <div>
            <p className="text-sm font-medium text-ink">Anfrage gesendet.</p>
            <p className="mt-1 text-xs text-muted">{state.message}</p>
          </div>
          <button
            type="button"
            onClick={close}
            className="mt-1 rounded-md border border-line px-5 py-2 text-sm text-muted hover:text-ink transition-colors"
          >
            Schließen
          </button>
        </div>
      ) : (
        <form action={formAction} className="space-y-4">
          <input type="hidden" name="category" value={category ?? "other"} />
          <input type="hidden" name="email" value={userEmail ?? ""} />

          {/* Category chips */}
          <div>
            <div className="mb-2 text-xs font-medium text-ink">Thema</div>
            <div className="grid grid-cols-2 gap-1.5">
              {CATEGORIES.map((cat) => (
                <button
                  key={cat.key}
                  type="button"
                  onClick={() => setCategory(cat.key === category ? null : cat.key)}
                  aria-pressed={category === cat.key}
                  className={`rounded border px-3 py-2 text-left text-xs transition-colors ${
                    category === cat.key
                      ? "border-brand/40 bg-brand/5 font-medium text-ink"
                      : "border-line text-muted hover:border-brand/30 hover:text-ink"
                  }`}
                >
                  {cat.label}
                </button>
              ))}
            </div>
          </div>

          {/* Description */}
          <div>
            <label htmlFor="support-desc" className="mb-1.5 block text-xs font-medium text-ink">
              Was ist passiert?{" "}
              <span className="font-normal text-muted">Je mehr Details, desto schneller.</span>
            </label>
            <textarea
              id="support-desc"
              name="description"
              required
              minLength={10}
              rows={4}
              placeholder={
                category ? PLACEHOLDERS[category] : "Beschreib kurz, womit wir dir helfen koennen."
              }
              className="w-full resize-none rounded border border-line bg-white px-3 py-2 text-sm text-ink placeholder:text-muted/50 focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand/20"
            />
          </div>

          {/* Reply email — only shown when not logged in */}
          {!userEmail && (
            <div>
              <label htmlFor="support-email" className="mb-1.5 block text-xs font-medium text-ink">
                Deine E-Mail-Adresse
              </label>
              <input
                id="support-email"
                name="email"
                type="email"
                required
                placeholder="name@firma.de"
                className="w-full rounded border border-line bg-white px-3 py-2 text-sm focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand/20"
              />
            </div>
          )}

          {/* Error */}
          {state.status === "error" && (
            <p role="alert" className="rounded border border-danger/30 bg-danger-soft px-3 py-2 text-xs text-danger">
              {state.message}
            </p>
          )}

          {/* Actions */}
          <div className="flex gap-2 pt-1">
            <button
              type="submit"
              disabled={isPending}
              className="flex-1 rounded-md bg-ink py-2 text-sm font-medium text-white hover:bg-ink/90 disabled:opacity-50 transition-opacity"
            >
              {isPending ? "Sende…" : "Anfrage senden"}
            </button>
            <button
              type="button"
              onClick={close}
              className="rounded-md border border-line px-4 py-2 text-sm text-muted hover:text-ink transition-colors"
            >
              Abbrechen
            </button>
          </div>
        </form>
      )}
    </Modal>
  );
}
