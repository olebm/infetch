"use client";

import { useActionState, useEffect, useRef, useState } from "react";
import { saveSmtpCredentialAction, testSmtpConnectionAction, type CredentialFormState } from "@/app/(app)/einstellungen/actions";
import { OverlaySecretPasswordInput } from "@/components/credentials/overlay-secret-password-input";
import { ProviderPresetGrid } from "@/components/credentials/provider-preset-grid";
import { VerifiedAt } from "@/components/status/relative-time";
import type { MailProvider } from "@/lib/mail-providers";

const initialState: CredentialFormState = {
  status: "idle",
  message: "Server und Login werden sicher gespeichert.",
};

const testInitialState: CredentialFormState = { status: "idle", message: "" };

export function SmtpAccountForm({
  slot,
  account,
  suggestedAccount,
  credentialStored = false,
  secretPresent = false,
  lastVerifiedAt = null,
}: {
  slot: "primary" | "secondary";
  account?: { host: string; port: number; secure: boolean; username: string; fromAddress: string };
  suggestedAccount?: { host?: string; port?: number; secure?: boolean; username?: string; fromAddress?: string };
  credentialStored?: boolean;
  secretPresent?: boolean;
  lastVerifiedAt?: string | null;
}) {
  const defaults = account ?? suggestedAccount;
  const [state, formAction, isPending] = useActionState(saveSmtpCredentialAction, initialState);
  const [testState, testAction, isTesting] = useActionState(testSmtpConnectionAction, testInitialState);
  const passwordRef = useRef<HTMLInputElement>(null);
  const [passwordLength, setPasswordLength] = useState(0);
  const heading = slot === "primary" ? "Versand-Server" : "Versand-Server 2";

  // Kontrollierte Felder für Provider-Preset-Befüllung
  const [host, setHost] = useState(defaults?.host || "");
  const [port, setPort] = useState(String(defaults?.port || 587));
  const [secure, setSecure] = useState(defaults ? Boolean(defaults.secure) : true);

  const secretOnFile = secretPresent || credentialStored || state.status === "success";
  const showStoredMask = secretOnFile && passwordLength === 0;

  const statusMessage = state.status !== "idle" ? state.message : initialState.message;

  useEffect(() => {
    if (state.status === "success" && passwordRef.current) {
      passwordRef.current.value = "";
      setPasswordLength(0);
    }
  }, [state.status]);

  function applyPreset(preset: MailProvider) {
    setHost(preset.smtp.host);
    setPort(String(preset.smtp.port));
    setSecure(preset.smtp.secure);
  }

  return (
    <form action={formAction} className="rounded border border-line/60 bg-white p-4">
      <input type="hidden" name="smtpSlot" value={slot} />

      <div className="mb-4">
        <h3 className="text-sm font-semibold">{heading}</h3>
        <p className="mt-0.5 text-sm text-muted">{statusMessage}</p>
      </div>

      {/* Provider-Presets */}
      <div className="mb-4">
        <ProviderPresetGrid mode="smtp" onSelect={applyPreset} />
      </div>

      <div className="grid gap-3 md:grid-cols-2">
        <input
          name="smtpHost"
          value={host}
          onChange={(e) => setHost(e.target.value)}
          placeholder="smtp.example.com"
          className="rounded border border-line bg-surface px-3 py-2 text-sm"
          required
        />
        <input
          name="smtpPort"
          type="number"
          min={1}
          max={65535}
          value={port}
          onChange={(e) => setPort(e.target.value)}
          className="rounded border border-line bg-surface px-3 py-2 text-sm"
          required
        />
        <input
          name="smtpUser"
          defaultValue={defaults?.username || ""}
          placeholder="mailer@example.com"
          autoComplete="username"
          className="rounded border border-line bg-surface px-3 py-2 text-sm"
          required
        />
        <input
          name="smtpFromAddress"
          defaultValue={defaults?.fromAddress || ""}
          placeholder="versand@example.com"
          autoComplete="email"
          className="rounded border border-line bg-surface px-3 py-2 text-sm"
          required
        />
        <div className="md:col-span-2">
          <label className="mb-1 block text-xs text-muted">Passwort</label>
          <OverlaySecretPasswordInput
            ref={passwordRef}
            name="smtpPassword"
            showStoredPlaceholder={showStoredMask}
            bulletCount={14}
            autoComplete="new-password"
            placeholder="SMTP Passwort oder App-Passwort"
            onInput={(event) => setPasswordLength(event.currentTarget.value.length)}
          />
        </div>
      </div>

      <div className="mt-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <label className="inline-flex items-center gap-2 text-sm text-muted">
          <input
            name="smtpSecure"
            type="checkbox"
            checked={secure}
            onChange={(e) => setSecure(e.target.checked)}
          />
          TLS/SSL verwenden
        </label>
        <div className="flex flex-wrap gap-2">
          <button
            type="submit"
            formAction={testAction}
            formNoValidate
            disabled={isTesting || !secretOnFile}
            className="rounded border border-line px-4 py-2 text-sm font-medium text-ink disabled:cursor-not-allowed disabled:opacity-60"
          >
            {isTesting ? "Teste..." : "Verbindung testen"}
          </button>
          <button
            type="submit"
            disabled={isPending}
            className="rounded bg-brand px-4 py-2 text-sm font-medium text-white disabled:cursor-not-allowed disabled:opacity-60"
          >
            {isPending ? "Speichere..." : "SMTP sicher speichern"}
          </button>
        </div>
      </div>

      <div className="mt-3 flex items-center justify-between gap-3">
        <div className="text-xs text-muted">
          {testState.status === "idle"
            ? "Prüfen, ob wir Mails verschicken können."
            : testState.message}
        </div>
        {secretOnFile && (
          <VerifiedAt value={testState.status === "success" ? new Date().toISOString() : lastVerifiedAt} />
        )}
      </div>
    </form>
  );
}
