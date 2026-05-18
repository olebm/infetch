"use client";

/**
 * MailboxConnectContent — Postfach-Setup mit Live-Provider-Erkennung.
 *
 * Der User tippt seine IMAP-E-Mail-Adresse; sobald die Domain erkannt wird,
 * werden IMAP- und SMTP-Server automatisch konfiguriert und ein Provider-Badge
 * eingeblendet. Bei unbekannten Domains öffnet sich das Server-Accordion
 * automatisch für manuelle Eingabe.
 *
 * mode="settings"   → eigenes <form> mit saveMailboxCredentialsAction
 * mode="onboarding" → kein Submit, gibt Daten via onDataChange() nach oben
 */

import { useState, useEffect, useActionState } from "react";
import { ChevronDown, ExternalLink, Check, WifiOff, Loader2 } from "lucide-react";
import { MAIL_PROVIDERS, MAIL_BACKENDS, type MailProvider, type MailBackend } from "@/lib/mail-providers";
import { VendorLogo } from "@/components/ui/vendor-logo";
import {
  saveMailboxCredentialsAction,
  type CredentialFormState,
} from "@/app/(app)/einstellungen/actions";
import { testMailConnectionAction } from "@/mail/connection-test";

// ── Types ─────────────────────────────────────────────────────────────────────

export type MailboxData = {
  email: string;
  password: string;
  smtpEmail: string;
  smtpPassword: string;
  imapHost: string;
  imapPort: number;
  imapSecure: boolean;
  smtpHost: string;
  smtpPort: number;
  smtpSecure: boolean;
  providerId: string | null;
};

interface MailboxConnectContentProps {
  mode: "settings" | "onboarding";
  slot?: "primary" | "secondary";
  initialEmail?: string;
  onDataChange?: (data: MailboxData | null) => void;
  onSuccess?: () => void;
}

const initialState: CredentialFormState = { status: "idle", message: "" };

function detectProvider(email: string): MailProvider | null {
  const at = email.lastIndexOf("@");
  if (at < 0) return null;
  const domain = email.slice(at + 1).toLowerCase();
  return MAIL_PROVIDERS.find((p) => p.domains.includes(domain)) ?? null;
}

// ── Component ─────────────────────────────────────────────────────────────────

export function MailboxConnectContent({
  mode,
  slot = "primary",
  initialEmail,
  onDataChange,
  onSuccess,
}: MailboxConnectContentProps) {
  const initProvider = initialEmail ? detectProvider(initialEmail) : null;

  const [email, setEmail]               = useState(initialEmail ?? "");
  const [password, setPassword]         = useState("");
  const [provider, setProvider]         = useState<MailProvider | null>(initProvider);
  const [showAdv, setShowAdv]           = useState(false);
  const [imapHost, setImapHost]         = useState(initProvider?.imap.host ?? "");
  const [imapPort, setImapPort]         = useState(initProvider?.imap.port ?? 993);
  const [imapSecure, setImapSecure]     = useState(initProvider?.imap.secure ?? true);
  const [smtpHost, setSmtpHost]         = useState(initProvider?.smtp.host ?? "");
  const [smtpPort, setSmtpPort]         = useState(initProvider?.smtp.port ?? 465);
  const [smtpSecure, setSmtpSecure]     = useState(initProvider?.smtp.secure ?? true);
  const [backend, setBackend]           = useState<MailBackend | null>(null);
  const [separateSmtp, setSeparateSmtp] = useState(false);
  const [smtpEmail, setSmtpEmail]       = useState("");
  const [smtpPassword, setSmtpPassword] = useState("");

  type SettingsTestPhase = "idle" | "testing" | "success" | "error";
  const [settingsTestPhase, setSettingsTestPhase] = useState<SettingsTestPhase>("idle");
  const [settingsTestErrors, setSettingsTestErrors] = useState<{ imap?: string; smtp?: string }>({});

  const [state, formAction, isPending] = useActionState(
    saveMailboxCredentialsAction,
    initialState,
  );

  useEffect(() => {
    if (mode === "settings" && state.status === "success" && onSuccess) {
      onSuccess();
    }
  }, [mode, state.status, onSuccess]);

  useEffect(() => {
    if (mode !== "onboarding" || !onDataChange) return;
    if (!email || !imapHost || !smtpHost) {
      onDataChange(null);
    } else {
      onDataChange({
        email,
        password,
        smtpEmail: separateSmtp ? smtpEmail : email,
        smtpPassword: separateSmtp ? smtpPassword : password,
        imapHost, imapPort, imapSecure,
        smtpHost, smtpPort, smtpSecure,
        providerId: provider?.id ?? null,
      });
    }
  }, [
    mode, onDataChange, email, password,
    imapHost, imapPort, imapSecure,
    smtpHost, smtpPort, smtpSecure, provider, backend,
    separateSmtp, smtpEmail, smtpPassword,
  ]);

  // ── Live provider detection ───────────────────────────────────────────────

  function applyServerSettings(s: { imap: { host: string; port: number; secure: boolean }; smtp: { host: string; port: number; secure: boolean } }) {
    setImapHost(s.imap.host); setImapPort(s.imap.port); setImapSecure(s.imap.secure);
    setSmtpHost(s.smtp.host); setSmtpPort(s.smtp.port); setSmtpSecure(s.smtp.secure);
  }

  function selectBackend(b: MailBackend) {
    setBackend(b);
    applyServerSettings(b);
  }

  function handleEmailChange(value: string) {
    setEmail(value);
    if (settingsTestPhase === "error") { setSettingsTestPhase("idle"); setSettingsTestErrors({}); }
    if (showAdv) return; // user is manually configuring — don't override

    const found = detectProvider(value);
    const hadProvider = provider !== null;
    const hadBackend = backend !== null;

    setProvider(found ?? null);

    if (found) {
      setBackend(null);
      applyServerSettings(found);
    } else if (hadProvider || hadBackend) {
      // Switched away from a known domain — clear auto-filled settings
      setBackend(null);
      setImapHost(""); setImapPort(993); setImapSecure(true);
      setSmtpHost(""); setSmtpPort(465); setSmtpSecure(true);
    }
  }

  async function handleSubmitWithTest(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const formData = new FormData(e.currentTarget);

    setSettingsTestPhase("testing");
    setSettingsTestErrors({});

    const fd = new FormData();
    fd.set("tcImapHost",   imapHost);
    fd.set("tcImapPort",   String(imapPort));
    fd.set("tcImapSecure", String(imapSecure));
    fd.set("tcImapUser",   email);
    fd.set("tcImapPass",   password);
    fd.set("tcSmtpHost",   smtpHost);
    fd.set("tcSmtpPort",   String(smtpPort));
    fd.set("tcSmtpSecure", String(smtpSecure));
    fd.set("tcSmtpUser",   separateSmtp ? smtpEmail : email);
    fd.set("tcSmtpPass",   separateSmtp ? smtpPassword : password);

    const result = await testMailConnectionAction(null, fd);

    if (result.imap.ok && result.smtp.ok) {
      setSettingsTestPhase("success");
      setTimeout(() => {
        setSettingsTestPhase("idle");
        formAction(formData);
      }, 700);
    } else {
      setSettingsTestPhase("error");
      setSettingsTestErrors({
        imap: result.imap.ok ? undefined : result.imap.error,
        smtp: result.smtp.ok ? undefined : result.smtp.error,
      });
    }
  }

  const emailHasDomain = email.includes("@") && email.slice(email.indexOf("@") + 1).length > 0;

  // ── Render ────────────────────────────────────────────────────────────────

  const inner = (
    <div className="space-y-4">

      {/* Email */}
      <div>
        <label className="mb-1 block text-xs font-medium text-muted">
          E-Mail-Adresse (Posteingang)
        </label>
        <input
          type="email"
          name={mode === "settings" ? "mailEmail" : undefined}
          value={email}
          onChange={(e) => handleEmailChange(e.target.value)}
          placeholder="rechnungen@example.com"
          autoComplete="username"
          inputMode="email"
          enterKeyHint="next"
          required
          className="h-9 w-full rounded border border-line bg-surface px-3 text-sm outline-none focus:border-brand focus:ring-2 focus:ring-brand/20"
        />
      </div>

      {/* Provider badge — shown when domain is recognised */}
      {provider && (
        <div className="flex items-center gap-2.5 rounded-md border border-ok/20 bg-ok/5 px-3 py-2">
          <VendorLogo domain={provider.domain} name={provider.name} size={20} />
          <span className="text-xs text-ink">
            <span className="font-medium">{provider.name}</span>
            {" "}erkannt — Server automatisch konfiguriert.
          </span>
        </div>
      )}

      {/* Backend badge — shown when user selected a backend for a custom domain */}
      {!provider && backend && (
        <div className="flex items-center justify-between gap-2.5 rounded-md border border-ok/20 bg-ok/5 px-3 py-2">
          <div className="flex items-center gap-2.5">
            <VendorLogo domain={backend.domain} name={backend.name} size={20} />
            <span className="text-xs text-ink">
              <span className="font-medium">{backend.name}</span>
              {" "}ausgewählt — Server automatisch konfiguriert.
            </span>
          </div>
          <button
            type="button"
            onClick={() => {
              setBackend(null);
              setImapHost(""); setImapPort(993); setImapSecure(true);
              setSmtpHost(""); setSmtpPort(465); setSmtpSecure(true);
            }}
            className="shrink-0 text-xs text-muted hover:text-ink"
          >
            Ändern
          </button>
        </div>
      )}

      {/* Unknown domain — backend picker, then manual fallback */}
      {!provider && !backend && emailHasDomain && !showAdv && (
        <div className="rounded-md border border-line bg-surface px-4 py-3">
          <p className="text-sm font-medium text-ink">Domain nicht erkannt — welchen Dienst nutzt du?</p>
          <p className="mt-0.5 text-xs text-muted">
            Wähle deinen E-Mail-Dienst und die Server-Daten werden automatisch eingetragen.
          </p>
          <div className="mt-3 flex flex-wrap gap-2">
            {MAIL_BACKENDS.map((b) => (
              <button
                key={b.id}
                type="button"
                onClick={() => selectBackend(b)}
                className="inline-flex items-center gap-1.5 rounded border border-line bg-white px-3 py-1.5 text-xs font-medium text-ink hover:border-brand hover:text-brand transition-colors"
              >
                <VendorLogo domain={b.domain} name={b.name} size={14} />
                {b.name}
              </button>
            ))}
          </div>
          <button
            type="button"
            onClick={() => setShowAdv(true)}
            className="mt-3 text-xs text-muted hover:text-ink"
          >
            Server-Details manuell eingeben →
          </button>
        </div>
      )}

      {/* ProtonMail Bridge special card */}
      {provider?.id === "protonmail" && (
        <div className="rounded-md border border-line bg-surface px-4 py-3 text-xs">
          <p className="font-medium text-ink">Proton Mail Bridge erforderlich</p>
          <p className="mt-0.5 text-muted">
            Proton Mail verschlüsselt alle E-Mails — externe Apps brauchen die Bridge als lokalen Proxy.
          </p>
          <ol className="mt-2.5 space-y-1.5 text-muted">
            <li className="flex gap-2">
              <span className="shrink-0 font-medium text-ink">1.</span>
              <span>
                <a href="https://proton.me/mail/bridge" target="_blank" rel="noopener noreferrer"
                  className="font-medium text-brand hover:underline inline-flex items-center gap-0.5">
                  Proton Mail Bridge herunterladen <ExternalLink size={10} aria-hidden />
                </a>{" "}und installieren
              </span>
            </li>
            <li className="flex gap-2">
              <span className="shrink-0 font-medium text-ink">2.</span>
              <span>In der Bridge mit deinem Proton-Konto anmelden</span>
            </li>
            <li className="flex gap-2">
              <span className="shrink-0 font-medium text-ink">3.</span>
              <span>Das <strong>Bridge-Passwort</strong> (nicht dein Proton-Login) aus der Bridge-App kopieren und unten eingeben</span>
            </li>
          </ol>
          <p className="mt-2 text-muted/70">
            IMAP (Port 1143) und SMTP (Port 1025) sind bereits auf die Bridge-Adresse voreingestellt.
          </p>
        </div>
      )}

      {/* App-password warning — above the password field so it's read before entry */}
      {provider?.id !== "protonmail" && (provider?.hint ?? backend?.hint) && (
        <div className="rounded-md border border-warn/20 bg-warn/5 px-3 py-2.5 text-xs text-ink">
          <span className="font-medium">Wichtig: </span>
          {provider?.hint ?? backend?.hint}
          {(provider?.appPasswordUrl ?? backend?.appPasswordUrl) && (
            <a
              href={provider?.appPasswordUrl ?? backend?.appPasswordUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="ml-1.5 inline-flex items-center gap-0.5 font-medium text-brand hover:underline"
            >
              App-Passwort erstellen <ExternalLink size={10} aria-hidden />
            </a>
          )}
        </div>
      )}

      {/* Password */}
      <div>
        <label className="mb-1 block text-xs font-medium text-muted">
          {provider?.id === "protonmail" ? "Bridge-Passwort" : (provider?.hint ?? backend?.hint) ? "App-Passwort" : "Passwort"}
        </label>
        <input
          type="password"
          name={mode === "settings" ? "mailPassword" : undefined}
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          placeholder="•••• •••• •••• ••••"
          autoComplete="new-password"
          enterKeyHint="done"
          className="h-9 w-full rounded border border-line bg-surface px-3 text-sm outline-none focus:border-brand focus:ring-2 focus:ring-brand/20"
        />
      </div>

      {/* Server-Details accordion */}
      <button
        type="button"
        onClick={() => setShowAdv((v) => !v)}
        className="inline-flex items-center gap-1.5 text-xs text-muted hover:text-ink"
      >
        <ChevronDown
          size={13}
          className={`transition-transform ${showAdv ? "rotate-180" : ""}`}
          aria-hidden
        />
        Server-Details
        {(provider ?? backend) && !showAdv && (
          <span className="text-muted/60">· automatisch konfiguriert</span>
        )}
      </button>

      {showAdv && (
        <div className="rounded border border-line/60 bg-surface p-4 space-y-4">
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            {/* IMAP */}
            <div>
              <div className="mb-2 text-xs font-medium text-muted">IMAP — Empfangs-Server</div>
              <div className="space-y-1.5">
                <input
                  value={imapHost}
                  onChange={(e) => setImapHost(e.target.value)}
                  placeholder="imap.example.com"
                  inputMode="url"
                  className="h-8 w-full rounded border border-line bg-white px-2 font-mono text-xs outline-none focus:border-brand"
                />
                <div className="flex items-center gap-2">
                  <input
                    type="number"
                    value={imapPort}
                    onChange={(e) => setImapPort(Number(e.target.value))}
                    inputMode="numeric"
                    className="h-8 w-20 rounded border border-line bg-white px-2 font-mono text-xs outline-none focus:border-brand"
                  />
                  <label className="flex items-center gap-1.5 text-xs text-muted cursor-pointer">
                    <input type="checkbox" checked={imapSecure} onChange={(e) => setImapSecure(e.target.checked)} />
                    SSL/TLS
                  </label>
                </div>
              </div>
            </div>
            {/* SMTP */}
            <div>
              <div className="mb-2 text-xs font-medium text-muted">SMTP — Versand-Server</div>
              <div className="space-y-1.5">
                <input
                  value={smtpHost}
                  onChange={(e) => setSmtpHost(e.target.value)}
                  placeholder="smtp.example.com"
                  inputMode="url"
                  className="h-8 w-full rounded border border-line bg-white px-2 font-mono text-xs outline-none focus:border-brand"
                />
                <div className="flex items-center gap-2">
                  <input
                    type="number"
                    value={smtpPort}
                    onChange={(e) => setSmtpPort(Number(e.target.value))}
                    inputMode="numeric"
                    className="h-8 w-20 rounded border border-line bg-white px-2 font-mono text-xs outline-none focus:border-brand"
                  />
                  <label className="flex items-center gap-1.5 text-xs text-muted cursor-pointer">
                    <input type="checkbox" checked={smtpSecure} onChange={(e) => setSmtpSecure(e.target.checked)} />
                    SSL/TLS
                  </label>
                </div>
              </div>
            </div>
          </div>

          {/* Separate SMTP credentials */}
          <div className="border-t border-line/60 pt-3">
            <label className="flex items-center gap-2 text-xs text-muted cursor-pointer select-none">
              <input
                type="checkbox"
                checked={separateSmtp}
                onChange={(e) => setSeparateSmtp(e.target.checked)}
              />
              Versand verwendet andere Zugangsdaten als Empfang
            </label>
            {separateSmtp && (
              <div className="mt-3 space-y-2">
                <input
                  type="email"
                  name={mode === "settings" ? "smtpEmail" : undefined}
                  value={smtpEmail}
                  onChange={(e) => setSmtpEmail(e.target.value)}
                  placeholder="versand@example.com"
                  autoComplete="username"
                  inputMode="email"
                  className="h-8 w-full rounded border border-line bg-white px-2 text-xs outline-none focus:border-brand"
                />
                <input
                  type="password"
                  name={mode === "settings" ? "smtpPassword" : undefined}
                  value={smtpPassword}
                  onChange={(e) => setSmtpPassword(e.target.value)}
                  placeholder="SMTP-Passwort"
                  autoComplete="new-password"
                  className="h-8 w-full rounded border border-line bg-white px-2 text-xs outline-none focus:border-brand"
                />
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );

  if (mode === "onboarding") return inner;

  return (
    <form onSubmit={handleSubmitWithTest} noValidate>
      <input type="hidden" name="mailSlot"     value={slot} readOnly />
      <input type="hidden" name="imapHost"     value={imapHost} readOnly />
      <input type="hidden" name="imapPort"     value={imapPort} readOnly />
      <input type="hidden" name="imapSecure"   value={String(imapSecure)} readOnly />
      <input type="hidden" name="smtpHost"     value={smtpHost} readOnly />
      <input type="hidden" name="smtpPort"     value={smtpPort} readOnly />
      <input type="hidden" name="smtpSecure"   value={String(smtpSecure)} readOnly />
      {!separateSmtp && <input type="hidden" name="smtpEmail"    value={email} readOnly />}
      {!separateSmtp && <input type="hidden" name="smtpPassword" value={password} readOnly />}

      {inner}

      {/* Connection test feedback */}
      {settingsTestPhase === "testing" && (
        <div className="mt-4 flex items-center gap-2 text-sm text-muted">
          <Loader2 size={14} className="animate-spin shrink-0" aria-hidden />
          <span>Prüfe IMAP und SMTP…</span>
        </div>
      )}
      {settingsTestPhase === "success" && (
        <div className="mt-4 flex items-center gap-3 text-sm text-ok">
          <span className="flex items-center gap-1"><Check size={14} aria-hidden /> IMAP verbunden</span>
          <span className="flex items-center gap-1"><Check size={14} aria-hidden /> SMTP verbunden</span>
        </div>
      )}
      {settingsTestPhase === "error" && (
        <div className="mt-4 rounded-md border border-danger/20 bg-danger/5 px-3 py-2.5 text-sm">
          <p className="flex items-center gap-1.5 font-medium text-danger">
            <WifiOff size={14} aria-hidden /> Verbindung fehlgeschlagen
          </p>
          {settingsTestErrors.imap && <p className="mt-1 text-xs text-danger"><strong>IMAP:</strong> {settingsTestErrors.imap}</p>}
          {settingsTestErrors.smtp && <p className="mt-1 text-xs text-danger"><strong>SMTP:</strong> {settingsTestErrors.smtp}</p>}
        </div>
      )}

      {/* Save result (shown after successful test + save) */}
      {state.status !== "idle" && state.message && settingsTestPhase === "idle" && (
        <p className={`mt-4 text-xs ${state.status === "error" ? "text-danger" : "text-ok"}`}>
          {state.status === "success" && <Check size={12} className="mr-1 inline" aria-hidden />}
          {state.message}
        </p>
      )}

      <div className="mt-5 flex justify-end">
        <button
          type="submit"
          disabled={settingsTestPhase === "testing" || settingsTestPhase === "success" || isPending || !email || !imapHost || !smtpHost}
          className="inline-flex h-9 items-center gap-2 rounded bg-brand px-4 text-sm font-medium text-white disabled:cursor-not-allowed disabled:opacity-50"
        >
          {settingsTestPhase === "testing"
            ? <><Loader2 size={14} className="animate-spin" aria-hidden /> Verbindung wird geprüft…</>
            : settingsTestPhase === "success"
              ? <><Check size={14} aria-hidden /> Verbunden</>
              : isPending
                ? "Speichert…"
                : "Postfach verbinden"}
        </button>
      </div>
    </form>
  );
}
