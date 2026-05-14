"use client";

/**
 * MailboxConnectContent — 2-Phasen-Provider-Picker für Postfach-Setup.
 *
 * Phase 1 "select": Grid mit bekannten Anbietern + "Anderer Anbieter"
 * Phase 2 "configure": E-Mail + Passwort; Server-Details automatisch oder via Accordion
 *
 * mode="settings"  → eigenes <form> mit saveMailboxCredentialsAction + Submit-Button;
 *                    ruft onSuccess() wenn gespeichert
 * mode="onboarding" → kein Submit, gibt Daten via onDataChange() nach oben
 */

import { useState, useEffect, useActionState } from "react";
import { ArrowLeft, ChevronDown, ExternalLink, Check } from "lucide-react";
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
  imapHost: string;
  imapPort: number;
  imapSecure: boolean;
  smtpHost: string;
  smtpPort: number;
  smtpSecure: boolean;
  providerId: string | null;
};

type Phase = "select" | "configure";

interface MailboxConnectContentProps {
  mode: "settings" | "onboarding";
  /** which mailbox slot to save into (default: "primary") */
  slot?: "primary" | "secondary";
  /** onboarding: called whenever configured data changes (null = incomplete) */
  onDataChange?: (data: MailboxData | null) => void;
  /** settings: called after successful save so the modal can close */
  onSuccess?: () => void;
}

const initialState: CredentialFormState = { status: "idle", message: "" };

// ── Component ─────────────────────────────────────────────────────────────────

export function MailboxConnectContent({
  mode,
  slot = "primary",
  onDataChange,
  onSuccess,
}: MailboxConnectContentProps) {
  const [phase, setPhase]             = useState<Phase>("select");
  const [provider, setProvider]       = useState<MailProvider | null>(null);
  const [isCustom, setIsCustom]       = useState(false);
  const [email, setEmail]             = useState("");
  const [password, setPassword]       = useState("");
  const [showAdv, setShowAdv]         = useState(false);
  const [imapHost, setImapHost]       = useState("");
  const [imapPort, setImapPort]       = useState(993);
  const [imapSecure, setImapSecure]   = useState(true);
  const [smtpHost, setSmtpHost]       = useState("");
  const [smtpPort, setSmtpPort]       = useState(465);
  const [smtpSecure, setSmtpSecure]   = useState(true);

  // Settings-mode action state
  const [state, formAction, isPending] = useActionState(
    saveMailboxCredentialsAction,
    initialState,
  );

  // ── onSuccess callback (settings mode) ──────────────────────────────────────
  useEffect(() => {
    if (mode === "settings" && state.status === "success" && onSuccess) {
      onSuccess();
    }
  }, [mode, state.status, onSuccess]);

  // ── onDataChange callback (onboarding mode) ──────────────────────────────────
  useEffect(() => {
    if (mode !== "onboarding" || !onDataChange) return;
    if (phase !== "configure" || !email || !imapHost || !smtpHost) {
      onDataChange(null);
    } else {
      onDataChange({
        email,
        password,
        imapHost,
        imapPort,
        imapSecure,
        smtpHost,
        smtpPort,
        smtpSecure,
        providerId: provider?.id ?? null,
      });
    }
  }, [
    mode, onDataChange, phase, email, password,
    imapHost, imapPort, imapSecure,
    smtpHost, smtpPort, smtpSecure, provider,
  ]);

  // ── Handlers ─────────────────────────────────────────────────────────────────

  function pickProvider(p: MailProvider) {
    setProvider(p);
    setIsCustom(false);
    setImapHost(p.imap.host);
    setImapPort(p.imap.port);
    setImapSecure(p.imap.secure);
    setSmtpHost(p.smtp.host);
    setSmtpPort(p.smtp.port);
    setSmtpSecure(p.smtp.secure);
    setShowAdv(false);
    setPhase("configure");
  }

  function pickCustom() {
    setProvider(null);
    setIsCustom(true);
    setImapHost("");
    setImapPort(993);
    setImapSecure(true);
    setSmtpHost("");
    setSmtpPort(465);
    setSmtpSecure(true);
    setShowAdv(true);
    setPhase("configure");
  }

  function goBack() {
    setPhase("select");
    setProvider(null);
    setIsCustom(false);
    setEmail("");
    setPassword("");
    setShowAdv(false);
  }

  // ── Phase: select ─────────────────────────────────────────────────────────────

  if (phase === "select") {
    return (
      <div>
        <p className="mb-4 text-xs text-muted">Wähle deinen Anbieter — wir konfigurieren den Rest automatisch.</p>
        <div className="grid grid-cols-3 gap-2 sm:grid-cols-4">
          {MAIL_PROVIDERS.map((p) => (
            <button
              key={p.id}
              type="button"
              onClick={() => pickProvider(p)}
              className="flex flex-col items-center gap-2 rounded-md border border-line bg-paper p-3 text-center transition-colors hover:border-brand/50 hover:bg-surface"
            >
              <VendorLogo domain={p.domain} name={p.name} size={28} />
              <span className="text-[11px] text-muted">{p.name}</span>
            </button>
          ))}
          {/* Custom provider */}
          <button
            type="button"
            onClick={pickCustom}
            className="flex flex-col items-center gap-2 rounded-md border border-dashed border-line bg-paper p-3 text-center transition-colors hover:border-brand/50 hover:bg-surface"
          >
            <div className="flex h-7 w-7 items-center justify-center rounded border border-line bg-surface text-sm text-muted">
              +
            </div>
            <span className="text-[11px] text-muted">Anderer</span>
          </button>
        </div>
      </div>
    );
  }

  // ── Phase: configure ─────────────────────────────────────────────────────────

  const configureInner = (
    <div>
      {/* Back + provider header */}
      <button
        type="button"
        onClick={goBack}
        className="mb-5 inline-flex items-center gap-1.5 text-sm text-muted hover:text-ink"
      >
        <ArrowLeft size={14} aria-hidden />
        Zurück
      </button>

      <div className="mb-5 flex items-center gap-3">
        {provider ? (
          <VendorLogo domain={provider.domain} name={provider.name} size={32} />
        ) : (
          <div className="flex h-8 w-8 items-center justify-center rounded border border-line bg-surface text-sm font-medium text-muted">
            ✉
          </div>
        )}
        <div className="min-w-0 flex-1">
          <div className="text-sm font-medium text-ink">
            {provider?.name ?? "Anderer Anbieter"}
          </div>
          {provider?.hint && (
            <div className="text-xs text-warn">{provider.hint}</div>
          )}
        </div>
        {provider?.appPasswordUrl && (
          <a
            href={provider.appPasswordUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex shrink-0 items-center gap-1 rounded border border-line px-2 py-1 text-xs text-muted hover:border-brand/50 hover:text-ink"
          >
            App-Passwort <ExternalLink size={11} aria-hidden />
          </a>
        )}
      </div>

      {/* Email + Password */}
      <div className="space-y-3">
        <div>
          <label className="mb-1 block text-xs font-medium text-muted">E-Mail-Adresse</label>
          <input
            type="email"
            name={mode === "settings" ? "mailEmail" : undefined}
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder={provider ? `ich@${provider.domain}` : "ich@example.com"}
            autoComplete="username"
            required
            className="h-9 w-full rounded border border-line bg-surface px-3 text-sm outline-none focus:border-brand focus:ring-2 focus:ring-brand/20"
          />
        </div>
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
            className="h-9 w-full rounded border border-line bg-surface px-3 text-sm outline-none focus:border-brand focus:ring-2 focus:ring-brand/20"
          />
        </div>
      </div>

      {/* Advanced accordion */}
      <button
        type="button"
        onClick={() => setShowAdv((v) => !v)}
        className="mt-4 inline-flex items-center gap-1.5 text-xs text-muted hover:text-ink"
      >
        <ChevronDown
          size={13}
          className={`transition-transform ${showAdv ? "rotate-180" : ""}`}
          aria-hidden
        />
        Server-Details
        {!isCustom && (
          <span className="text-muted/60">
            · automatisch konfiguriert
          </span>
        )}
      </button>

      {showAdv && (
        <div className="mt-3 rounded border border-line/60 bg-surface p-4">
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            {/* IMAP */}
            <div>
              <div className="mb-2 text-xs font-medium text-muted">IMAP (Empfang)</div>
              <div className="space-y-1.5">
                <input
                  value={imapHost}
                  onChange={(e) => setImapHost(e.target.value)}
                  placeholder="imap.example.com"
                  className="h-8 w-full rounded border border-line bg-white px-2 font-mono text-xs outline-none focus:border-brand"
                />
                <div className="flex items-center gap-2">
                  <input
                    type="number"
                    value={imapPort}
                    onChange={(e) => setImapPort(Number(e.target.value))}
                    className="h-8 w-20 rounded border border-line bg-white px-2 font-mono text-xs outline-none focus:border-brand"
                  />
                  <label className="flex items-center gap-1.5 text-xs text-muted">
                    <input
                      type="checkbox"
                      checked={imapSecure}
                      onChange={(e) => setImapSecure(e.target.checked)}
                    />
                    SSL/TLS
                  </label>
                </div>
              </div>
            </div>
            {/* SMTP */}
            <div>
              <div className="mb-2 text-xs font-medium text-muted">SMTP (Versand)</div>
              <div className="space-y-1.5">
                <input
                  value={smtpHost}
                  onChange={(e) => setSmtpHost(e.target.value)}
                  placeholder="smtp.example.com"
                  className="h-8 w-full rounded border border-line bg-white px-2 font-mono text-xs outline-none focus:border-brand"
                />
                <div className="flex items-center gap-2">
                  <input
                    type="number"
                    value={smtpPort}
                    onChange={(e) => setSmtpPort(Number(e.target.value))}
                    className="h-8 w-20 rounded border border-line bg-white px-2 font-mono text-xs outline-none focus:border-brand"
                  />
                  <label className="flex items-center gap-1.5 text-xs text-muted">
                    <input
                      type="checkbox"
                      checked={smtpSecure}
                      onChange={(e) => setSmtpSecure(e.target.checked)}
                    />
                    SSL/TLS
                  </label>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );

  // ── Onboarding mode: no form wrapper ─────────────────────────────────────────

  if (mode === "onboarding") {
    return configureInner;
  }

  // ── Settings mode: wrap in form ───────────────────────────────────────────────

  return (
    <form action={formAction} noValidate>
      {/* Hidden server fields — always submitted */}
      <input type="hidden" name="mailSlot"   value={slot} readOnly />
      <input type="hidden" name="imapHost"   value={imapHost} readOnly />
      <input type="hidden" name="imapPort"   value={imapPort} readOnly />
      <input type="hidden" name="imapSecure" value={String(imapSecure)} readOnly />
      <input type="hidden" name="smtpHost"   value={smtpHost} readOnly />
      <input type="hidden" name="smtpPort"   value={smtpPort} readOnly />
      <input type="hidden" name="smtpSecure" value={String(smtpSecure)} readOnly />

      {configureInner}

      {/* Feedback */}
      {state.status !== "idle" && state.message && (
        <p
          className={`mt-4 text-xs ${
            state.status === "error" ? "text-danger" : "text-ok"
          }`}
        >
          {state.status === "success" && <Check size={12} className="mr-1 inline" aria-hidden />}
          {state.message}
        </p>
      )}

      {/* Submit */}
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
