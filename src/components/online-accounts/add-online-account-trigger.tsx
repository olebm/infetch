"use client";

import { useActionState, useState } from "react";
import { ArrowLeft, ArrowRight, CheckCircle2, Loader2, Plus, X } from "lucide-react";
import { connectOnlineAccountAction, type ConnectState } from "@/app/(app)/online-accounts/actions";
import { PORTAL_CATEGORIES } from "@/vendors/registry";
import { VendorCombobox, type VendorOption } from "@/components/online-accounts/vendor-combobox";

const idle: ConnectState = { status: "idle", message: "" };

type Step = "vendor" | "credentials" | "result";
type Mode = "existing" | "new";

export function AddOnlineAccountTrigger({
  candidateVendors,
}: {
  candidateVendors: Array<{ canonicalKey: string; name: string }>;
}) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="inline-flex items-center gap-2 rounded bg-brand px-3 py-2 text-sm font-medium text-white shadow-soft"
      >
        <Plus className="h-4 w-4" aria-hidden />
        Online-Konto hinzufügen
      </button>
      {open && (
        <AddOnlineAccountModal candidateVendors={candidateVendors} onClose={() => setOpen(false)} />
      )}
    </>
  );
}

function AddOnlineAccountModal({
  candidateVendors,
  onClose,
}: {
  candidateVendors: Array<{ canonicalKey: string; name: string }>;
  onClose: () => void;
}) {
  const [userStep, setUserStep] = useState<Step>("vendor");
  const [mode, setMode] = useState<Mode>(candidateVendors.length > 0 ? "existing" : "new");
  const [existingKey, setExistingKey] = useState<string>("");
  const [newName, setNewName] = useState<string>("");

  const [state, formAction, isPending] = useActionState(connectOnlineAccountAction, idle);

  const step: Step = state.status !== "idle" ? "result" : userStep;
  const setStep = setUserStep;

  const vendorOptions: VendorOption[] = candidateVendors.map((v) => ({
    canonicalKey: v.canonicalKey,
    name: v.name,
  }));

  const canProceedFromVendor =
    (mode === "existing" && existingKey) || (mode === "new" && newName.trim().length >= 2);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
      onClick={onClose}
    >
      <div
        className="max-h-[90vh] w-full max-w-xl overflow-hidden rounded-lg bg-white shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-line px-5 py-4">
          <div className="flex items-center gap-3">
            {step === "credentials" && state.status === "idle" && (
              <button
                type="button"
                onClick={() => setStep("vendor")}
                className="text-muted hover:text-ink"
                aria-label="Zurück"
              >
                <ArrowLeft className="h-4 w-4" aria-hidden />
              </button>
            )}
            <h2 className="text-base font-semibold">
              {step === "vendor" && "Lieferant wählen"}
              {step === "credentials" && "Online-Konto verbinden"}
              {step === "result" &&
                (state.status === "success" ? "Verbunden!" : "Verbindung fehlgeschlagen")}
            </h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="text-muted hover:text-ink"
            aria-label="Schließen"
          >
            <X className="h-4 w-4" aria-hidden />
          </button>
        </div>

        {step === "vendor" && (
          <div className="space-y-5 px-5 py-5">
            {candidateVendors.length > 0 && (
              <ModeOption
                active={mode === "existing"}
                onClick={() => setMode("existing")}
                title="Aus deinem Posteingang"
                description="Wir haben diese Lieferanten bereits in deinen Mails gesehen."
              >
                {mode === "existing" && (
                  <div className="mt-3">
                    <VendorCombobox
                      options={vendorOptions}
                      value={existingKey}
                      onChange={setExistingKey}
                    />
                  </div>
                )}
              </ModeOption>
            )}

            <ModeOption
              active={mode === "new"}
              onClick={() => setMode("new")}
              title="Neuer Lieferant"
              description="Trag den Namen ein — wir legen ihn an, sobald du verbindest."
            >
              {mode === "new" && (
                <input
                  autoFocus
                  value={newName}
                  onChange={(e) => setNewName(e.target.value)}
                  placeholder="z. B. EnBW, Adobe, Hetzner..."
                  className="mt-3 w-full rounded border border-line bg-surface px-3 py-2 text-sm"
                />
              )}
            </ModeOption>

            <div className="flex justify-end gap-2 border-t border-line pt-4">
              <button
                type="button"
                onClick={onClose}
                className="rounded border border-line px-3 py-2 text-sm text-muted hover:text-ink"
              >
                Abbrechen
              </button>
              <button
                type="button"
                disabled={!canProceedFromVendor}
                onClick={() => setStep("credentials")}
                className="inline-flex items-center gap-2 rounded bg-brand px-4 py-2 text-sm font-medium text-white disabled:cursor-not-allowed disabled:opacity-60"
              >
                Weiter <ArrowRight className="h-4 w-4" aria-hidden />
              </button>
            </div>
          </div>
        )}

        {step === "credentials" && (
          <form action={formAction} className="space-y-4 px-5 py-5">
            <input type="hidden" name="mode" value={mode} />
            {mode === "existing" && <input type="hidden" name="vendorKey" value={existingKey} />}
            {mode === "new" && <input type="hidden" name="vendorName" value={newName} />}

            <div className="rounded border border-line bg-surface p-3 text-xs text-muted">
              {mode === "existing"
                ? `Lieferant: ${candidateVendors.find((v) => v.canonicalKey === existingKey)?.name ?? existingKey}`
                : `Neuer Lieferant: ${newName}`}
            </div>

            <label className="block">
              <span className="mb-1 block text-xs font-medium text-muted">Login-URL</span>
              <input
                name="loginUrl"
                type="url"
                placeholder="https://login.lieferant.de"
                required
                className="w-full rounded border border-line bg-surface px-3 py-2 text-sm"
              />
              <span className="mt-1 block text-xs text-muted">
                Genau die Seite, auf der du dich normalerweise einloggst.
              </span>
            </label>

            <label className="block">
              <span className="mb-1 block text-xs font-medium text-muted">
                Benutzername / E-Mail
              </span>
              <input
                name="username"
                type="text"
                autoComplete="username"
                required
                className="w-full rounded border border-line bg-surface px-3 py-2 text-sm"
              />
            </label>

            <label className="block">
              <span className="mb-1 block text-xs font-medium text-muted">Passwort</span>
              <input
                name="password"
                type="password"
                autoComplete="new-password"
                required
                className="w-full rounded border border-line bg-surface px-3 py-2 text-sm"
              />
            </label>

            <label className="block">
              <span className="mb-1 block text-xs font-medium text-muted">
                Kategorie (optional)
              </span>
              <select
                name="category"
                defaultValue=""
                className="w-full rounded border border-line bg-surface px-3 py-2 text-sm"
              >
                <option value="">— wählen —</option>
                {Object.entries(PORTAL_CATEGORIES).map(([key, meta]) => (
                  <option key={key} value={key}>
                    {meta.label}
                  </option>
                ))}
              </select>
            </label>

            <TotpField />

            <div className="rounded border border-line bg-surface px-3 py-2 text-xs text-muted">
              Dein Passwort wird sicher im Schlüssel-Bund deines Macs gespeichert. Wir schicken es
              niemals weiter.
            </div>

            <div className="rounded border border-warn/30 bg-warn-soft px-3 py-2 text-xs text-warn">
              Beim ersten Mal kann der Abruf 30–60 Sekunden dauern, weil wir uns merken, wie das
              Portal funktioniert. Spätere Abrufe sind in wenigen Sekunden fertig.
            </div>

            <div className="flex justify-end gap-2 border-t border-line pt-4">
              <button
                type="button"
                onClick={onClose}
                disabled={isPending}
                className="rounded border border-line px-3 py-2 text-sm text-muted hover:text-ink"
              >
                Abbrechen
              </button>
              <button
                type="submit"
                disabled={isPending}
                className="inline-flex items-center gap-2 rounded bg-brand px-4 py-2 text-sm font-medium text-white disabled:cursor-not-allowed disabled:opacity-60"
              >
                {isPending ? (
                  <>
                    <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> Verbinde…
                  </>
                ) : (
                  "Verbinden"
                )}
              </button>
            </div>
          </form>
        )}

        {step === "result" && (
          <div className="space-y-4 px-5 py-8 text-center">
            {state.status === "success" ? (
              <>
                <CheckCircle2 className="mx-auto h-12 w-12 text-ok" aria-hidden />
                <h3 className="text-lg font-semibold">{state.message}</h3>
                <p className="text-sm text-muted">
                  Die Rechnungen liegen jetzt in deinem Posteingang. Ab jetzt holen wir neue
                  Rechnungen automatisch im Hintergrund.
                </p>
              </>
            ) : (
              <>
                <X className="mx-auto h-12 w-12 text-danger" aria-hidden />
                <h3 className="text-lg font-semibold">Das hat nicht geklappt</h3>
                <p className="text-sm text-muted">{state.message}</p>
              </>
            )}
            <button
              type="button"
              onClick={onClose}
              className="rounded bg-brand px-4 py-2 text-sm font-medium text-white"
            >
              Schließen
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

function TotpField() {
  const [open, setOpen] = useState(false);
  return (
    <div className="rounded border border-line bg-surface p-3">
      <label className="flex items-start gap-2 text-sm">
        <input
          type="checkbox"
          checked={open}
          onChange={(e) => setOpen(e.target.checked)}
          className="mt-1 h-4 w-4"
        />
        <div className="flex-1">
          <div className="font-medium">Zwei-Faktor-Authentifizierung (TOTP)</div>
          <div className="mt-0.5 text-xs text-muted">
            Wenn dein Konto einen 6-stelligen Code aus einer Authenticator-App fordert, hinterleg
            hier den Schlüssel. Wir generieren den Code dann automatisch.
          </div>
        </div>
      </label>
      {open && (
        <div className="mt-3 space-y-2">
          <input
            name="totpSecret"
            type="text"
            placeholder="z. B. JBSWY3DPEHPK3PXP (aus dem Authenticator-Setup)"
            autoComplete="off"
            className="w-full rounded border border-line bg-white px-3 py-2 font-mono text-sm tracking-wider"
          />
          <p className="text-xs text-muted">
            Das ist der gleiche Schlüssel, den deine Authenticator-App (z. B. 1Password, Authy,
            Google Authenticator) beim Einrichten gespeichert hat. Bei den meisten Portalen kannst
            du ihn unter „2FA-Einstellungen → Schlüssel manuell eingeben“ anzeigen lassen.
          </p>
        </div>
      )}
    </div>
  );
}

function ModeOption({
  active,
  onClick,
  title,
  description,
  children,
}: {
  active: boolean;
  onClick: () => void;
  title: string;
  description: string;
  children?: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`w-full rounded border p-3 text-left transition ${
        active ? "border-brand bg-brand/5" : "border-line bg-white hover:border-brand/40"
      }`}
    >
      <div className="flex items-start gap-3">
        <span
          className={`mt-1 h-4 w-4 shrink-0 rounded-full border-2 ${
            active ? "border-brand bg-brand" : "border-line bg-white"
          }`}
          aria-hidden
        />
        <div className="min-w-0 flex-1">
          <div className="text-sm font-semibold">{title}</div>
          <div className="mt-0.5 text-xs text-muted">{description}</div>
          {active && children}
        </div>
      </div>
    </button>
  );
}
