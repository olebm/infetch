"use client";

import { useActionState, useEffect, useRef, useState } from "react";
import {
  saveImapCredentialAction,
  testImapConnectionAction,
  type CredentialFormState,
} from "@/app/(app)/einstellungen/actions";
import { OverlaySecretPasswordInput } from "@/components/credentials/overlay-secret-password-input";
import { ProviderPresetGrid } from "@/components/credentials/provider-preset-grid";
import { VerifiedAt } from "@/components/status/relative-time";
import type { MailProvider } from "@/lib/mail-providers";

const initialState: CredentialFormState = {
  status: "idle",
  message: "Server und Login werden sicher gespeichert.",
};

export function ImapAccountForm({
  slot,
  account,
  credentialStored = false,
  secretPresent = false,
  lastVerifiedAt = null,
}: {
  slot: "primary" | "secondary";
  account?: { host: string; port: number; secure: number; username: string };
  credentialStored?: boolean;
  secretPresent?: boolean;
  lastVerifiedAt?: string | null;
}) {
  const [state, formAction, isPending] = useActionState(saveImapCredentialAction, initialState);
  const [testState, testAction, isTesting] = useActionState(testImapConnectionAction, initialState);
  const passwordRef = useRef<HTMLInputElement>(null);
  const [passwordLength, setPasswordLength] = useState(0);

  // Kontrollierte Felder, damit Provider-Presets sie befüllen können
  const [host, setHost] = useState(account?.host || "");
  const [port, setPort] = useState(String(account?.port || 993));
  const [secure, setSecure] = useState(account ? Boolean(account.secure) : true);

  const heading = slot === "primary" ? "Empfangs-Postfach" : "Empfangs-Postfach 2";
  const secretOnFile = secretPresent || credentialStored || state.status === "success";
  const showStoredMask = secretOnFile && passwordLength === 0;

  useEffect(() => {
    if (state.status === "success" && passwordRef.current) {
      passwordRef.current.value = "";
      setPasswordLength(0);
    }
  }, [state.status]);

  function applyPreset(preset: MailProvider) {
    setHost(preset.imap.host);
    setPort(String(preset.imap.port));
    setSecure(preset.imap.secure);
  }

  return (
    <form action={formAction} className="rounded border border-line/60 bg-white p-4">
      <input type="hidden" name="imapSlot" value={slot} />

      <div className="mb-4">
        <h3 className="text-sm font-semibold">{heading}</h3>
        <p className="mt-0.5 text-sm text-muted">{state.status !== "idle" ? state.message : initialState.message}</p>
      </div>

      {/* Provider-Presets */}
      <div className="mb-4">
        <ProviderPresetGrid mode="imap" onSelect={applyPreset} />
      </div>

      <div className="grid gap-3 md:grid-cols-2">
        <div>
          <label className="mb-1 block text-xs text-muted">Server-Adresse</label>
          <input
            name="imapHost"
            value={host}
            onChange={(e) => setHost(e.target.value)}
            placeholder="imap.example.com"
            className="w-full rounded border border-line bg-surface px-3 py-2 text-sm"
            required
          />
        </div>
        <div>
          <label className="mb-1 block text-xs text-muted">Port</label>
          <input
            name="imapPort"
            type="number"
            min={1}
            max={65535}
            value={port}
            onChange={(e) => setPort(e.target.value)}
            className="w-full rounded border border-line bg-surface px-3 py-2 text-sm"
            required
          />
        </div>
        <div>
          <label className="mb-1 block text-xs text-muted">Benutzername</label>
          <input
            name="imapUser"
            defaultValue={account?.username || ""}
            placeholder="rechnung@example.com"
            autoComplete="username"
            className="w-full rounded border border-line bg-surface px-3 py-2 text-sm"
            required
          />
        </div>
        <div className="min-w-0">
          <label className="mb-1 block text-xs text-muted">Passwort</label>
          <OverlaySecretPasswordInput
            ref={passwordRef}
            name="imapPassword"
            showStoredPlaceholder={showStoredMask}
            bulletCount={14}
            autoComplete="new-password"
            placeholder="Passwort oder App-Passwort"
            onInput={(event) => setPasswordLength(event.currentTarget.value.length)}
          />
        </div>
      </div>

      <div className="mt-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <label className="inline-flex items-center gap-2 text-sm text-muted">
          <input
            name="imapSecure"
            type="checkbox"
            checked={secure}
            onChange={(e) => setSecure(e.target.checked)}
          />
          Verschlüsselte Verbindung
        </label>
        <div className="flex flex-wrap gap-2">
          <button
            type="submit"
            formAction={testAction}
            formNoValidate
            disabled={isTesting || !secretOnFile}
            className="rounded border border-line px-4 py-2.5 text-sm font-medium text-ink disabled:cursor-not-allowed disabled:opacity-60"
          >
            {isTesting ? "Teste..." : "Verbindung testen"}
          </button>
          <button
            type="submit"
            disabled={isPending}
            className="rounded bg-brand px-4 py-2.5 text-sm font-medium text-white disabled:cursor-not-allowed disabled:opacity-60"
          >
            {isPending ? "Speichere..." : "IMAP sicher speichern"}
          </button>
        </div>
      </div>

      <div className="mt-3 flex items-center justify-between gap-3">
        <div className="text-xs text-muted">
          {testState.status === "idle" ? "Prüfen, ob wir uns einloggen können." : testState.message}
        </div>
        {secretOnFile && (
          <VerifiedAt value={testState.status === "success" ? new Date().toISOString() : lastVerifiedAt} />
        )}
      </div>
    </form>
  );
}
