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
import { ChevronDown, ExternalLink, Check } from "lucide-react";
import { MAIL_PROVIDERS, type MailProvider } from "@/lib/mail-providers";
import { VendorLogo } from "@/components/ui/vendor-logo";
import {
  saveMailboxCredentialsAction,
  type CredentialFormState,
} from "@/app/(app)/einstellungen/actions";

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
  onDataChange,
  onSuccess,
}: MailboxConnectContentProps) {
  const [email, setEmail]               = useState("");
  const [password, setPassword]         = useState("");
  const [provider, setProvider]         = useState<MailProvider | null>(null);
  const [showAdv, setShowAdv]           = useState(false);
  const [imapHost, setImapHost]         = useState("");
  const [imapPort, setImapPort]         = useState(993);
  const [imapSecure, setImapSecure]     = useState(true);
  const [smtpHost, setSmtpHost]         = useState("");
  const [smtpPort, setSmtpPort]         = useState(465);
  const [smtpSecure, setSmtpSecure]     = useState(true);
  const [separateSmtp, setSeparateSmtp] = useState(false);
  const [smtpEmail, setSmtpEmail]       = useState("");
  const [smtpPassword, setSmtpPassword] = useState("");

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
    smtpHost, smtpPort, smtpSecure, provider,
    separateSmtp, smtpEmail, smtpPassword,
  ]);

  // ── Live provider detection ───────────────────────────────────────────────

  function handleEmailChange(value: string) {
    setEmail(value);
    if (showAdv) return; // user is manually configuring — don't override

    const found = detectProvider(value);
    const hadProvider = provider !== null;

    setProvider(found ?? null);

    if (found) {
      setImapHost(found.imap.host);
      setImapPort(found.imap.port);
      setImapSecure(found.imap.secure);
      setSmtpHost(found.smtp.host);
      setSmtpPort(found.smtp.port);
      setSmtpSecure(found.smtp.secure);
    } else {
      // Unknown domain after "@": clear auto-filled settings, open accordion
      if (hadProvider) {
        setImapHost(""); setImapPort(993); setImapSecure(true);
        setSmtpHost(""); setSmtpPort(465); setSmtpSecure(true);
      }
      if (value.includes("@")) setShowAdv(true);
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

      {/* Provider badge */}
      {provider && (
        <div className="flex items-center gap-2.5 rounded-md border border-ok/20 bg-ok/5 px-3 py-2">
          <VendorLogo domain={provider.domain} name={provider.name} size={20} />
          <span className="flex-1 text-xs text-ink">
            <span className="font-medium">{provider.name}</span>
            {" "}erkannt — Server automatisch konfiguriert.
          </span>
          {provider.appPasswordUrl && (
            <a
              href={provider.appPasswordUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex shrink-0 items-center gap-1 rounded border border-line bg-white px-2 py-0.5 text-[11px] text-muted hover:border-brand/50 hover:text-ink"
            >
              App-Passwort <ExternalLink size={10} aria-hidden />
            </a>
          )}
        </div>
      )}

      {/* Unknown domain hint */}
      {!provider && emailHasDomain && (
        <p className="text-xs text-muted">
          Unbekannter Anbieter — bitte Server-Details unten eingeben.
        </p>
      )}

      {/* Provider hint (e.g. "App-Passwort nötig") */}
      {provider?.hint && (
        <p className="text-xs text-warn">{provider.hint}</p>
      )}

      {/* Password */}
      <div>
        <label className="mb-1 block text-xs font-medium text-muted">
          {provider?.hint ? "App-Passwort" : "Passwort"}
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
        {provider && !showAdv && (
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
    <form action={formAction} noValidate>
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

      {state.status !== "idle" && state.message && (
        <p className={`mt-4 text-xs ${state.status === "error" ? "text-danger" : "text-ok"}`}>
          {state.status === "success" && <Check size={12} className="mr-1 inline" aria-hidden />}
          {state.message}
        </p>
      )}

      <div className="mt-5 flex justify-end">
        <button
          type="submit"
          disabled={isPending || !email || !imapHost || !smtpHost}
          className="inline-flex h-9 items-center gap-2 rounded bg-brand px-4 text-sm font-medium text-white disabled:cursor-not-allowed disabled:opacity-50"
        >
          {isPending ? "Verbinde…" : "Postfach verbinden"}
        </button>
      </div>
    </form>
  );
}
