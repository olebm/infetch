"use client";

/**
 * MailboxConnectContent — Postfach-Setup mit Hintergrund-Erkennung.
 *
 * Der User tippt seine E-Mail-Adresse. Erkennung in zwei Stufen:
 *  1. Bekannte Freemail-Domain (gmail.com, gmx.de …) → sofort per Domain-Liste.
 *  2. Eigene Domain (info@firma.de) → beim Verlassen des Felds ein MX-Lookup im
 *     Hintergrund gegen die Hoster-Bibliothek (IONOS, webgo, All-Inkl …).
 *
 * Progressive Disclosure: Server-Felder erscheinen nur, wo wir sie NICHT selbst
 * ableiten können — fester/ableitbarer Server → nur Passwort; kundenspezifischer
 * Server → nur das Server-Feld; gar nichts erkannt → voller manueller Modus mit
 * Port + Verschlüsselung. Microsoft 365 wird erkannt, aber ehrlich als
 * (per Passwort) nicht verbindbar gewarnt.
 *
 * mode="settings"   → eigenes <form>; Action je nach purpose (imap-/smtp-only/full)
 * mode="onboarding" → kein Submit, gibt Daten via onDataChange() nach oben
 */

import { useState, useEffect, useActionState } from "react";
import { ChevronDown, ExternalLink, Check, WifiOff, Loader2, AlertTriangle } from "lucide-react";
import { MAIL_PROVIDERS, type MailProvider } from "@/lib/mail-providers";
import { lookupMailHosterAction } from "@/mail/mail-hoster-lookup";
import type { HosterDetection } from "@/lib/mail-hosters";
import { VendorLogo } from "@/components/ui/vendor-logo";
import {
  saveMailboxCredentialsAction,
  saveImapMailboxAction,
  saveSmtpMailboxAction,
  type CredentialFormState,
} from "@/app/(app)/einstellungen/actions";
import { testImapOnlyConnectionAction, testSmtpOnlyConnectionAction } from "@/mail/connection-test";

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
  slot?: "primary" | "secondary" | "tertiary";
  initialEmail?: string;
  /** Vorbefüllter Login-Name, falls abweichend von der E-Mail (z. B. webgo-Postfachname). */
  initialUsername?: string;
  /**
   * Optional vorausgefüllte Server-Werte — z. B. wenn der Wizard
   * nach Back-Navigation diese Komponente neu mountet und der
   * Parent-State bereits IMAP/SMTP-Defaults oder vom User getippte
   * Custom-Werte hält. Hat Vorrang vor Provider-Auto-Detection.
   */
  initialServers?: {
    imapHost?: string;
    imapPort?: number;
    imapSecure?: boolean;
    smtpHost?: string;
    smtpPort?: number;
    smtpSecure?: boolean;
  };
  onDataChange?: (data: MailboxData | null) => void;
  onSuccess?: () => void;
  /**
   * "full"      — beide Server (Default)
   * "imap-only" — nur Empfangs-Server (Onboarding Step 1)
   * "smtp-only" — nur Versand-Server (Onboarding Step 3)
   */
  purpose?: "full" | "imap-only" | "smtp-only";
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
  initialUsername,
  initialServers,
  onDataChange,
  onSuccess,
  purpose = "full",
}: MailboxConnectContentProps) {
  const smtpOnly = purpose === "smtp-only";
  const imapOnly = purpose === "imap-only";
  const initProvider = initialEmail ? detectProvider(initialEmail) : null;
  // Reihenfolge: explizite Initial-Server (vom Parent) → Provider-Preset → harter Fallback.
  const initImapHost = initialServers?.imapHost ?? initProvider?.imap.host ?? "";
  const initImapPort = initialServers?.imapPort ?? initProvider?.imap.port ?? 993;
  const initSmtpHost = initialServers?.smtpHost ?? initProvider?.smtp.host ?? "";
  const initSmtpPort = initialServers?.smtpPort ?? initProvider?.smtp.port ?? 587;
  // Falls Parent custom Server-Werte mitgibt, soll der Server-Details-Accordion
  // direkt aufgeklappt sein — User sieht sofort, dass die Felder befüllt sind.
  const initShowAdv =
    Boolean(initialServers?.imapHost || initialServers?.smtpHost) && !initProvider;

  const [email, setEmail] = useState(initialEmail ?? "");
  const [password, setPassword] = useState("");
  const [provider, setProvider] = useState<MailProvider | null>(initProvider);
  // Hintergrund-Erkennung per MX-Lookup (für eigene Domains).
  const [detection, setDetection] = useState<HosterDetection | null>(null);
  const [lookupState, setLookupState] = useState<"idle" | "looking" | "unknown">("idle");
  const [showAdv, setShowAdv] = useState(initShowAdv);
  const [imapHost, setImapHost] = useState(initImapHost);
  const [imapPort, setImapPort] = useState(initImapPort);
  const [smtpHost, setSmtpHost] = useState(initSmtpHost);
  // Fallback für unbekannte Domain: 587 + STARTTLS (heutiger Standard, weit
  // verbreitet bei Custom-Domains/Hostern). Provider-Presets überschreiben das.
  const [smtpPort, setSmtpPort] = useState(initSmtpPort);

  // TLS-Modus aus dem Port ableiten statt separater Checkbox: implizites TLS nur
  // auf 993 (IMAP) / 465 (SMTP); alle anderen Ports nutzen STARTTLS (secure=false,
  // trotzdem verschlüsselt). Deckt alle Provider-Presets und die Hoster-Bibliothek ab.
  const imapSecure = imapPort === 993;
  const smtpSecure = smtpPort === 465;
  const [separateSmtp, setSeparateSmtp] = useState(false);
  const [smtpEmail, setSmtpEmail] = useState("");
  const [smtpPassword, setSmtpPassword] = useState("");
  // Abweichender Login-Name (z. B. älteres webgo-Postfach web000p1). Leer = E-Mail
  // als Benutzername. Vorbelegt nur, wenn er sich von der E-Mail unterscheidet.
  const [smtpUsername, setSmtpUsername] = useState(
    initialUsername && initialUsername !== initialEmail ? initialUsername : "",
  );

  type SettingsTestPhase = "idle" | "testing" | "success" | "error";
  const [settingsTestPhase, setSettingsTestPhase] = useState<SettingsTestPhase>("idle");
  const [settingsTestErrors, setSettingsTestErrors] = useState<{ imap?: string; smtp?: string }>(
    {},
  );

  // Settings-Mode: Action nach purpose. smtp-only speichert nur ein Absende-Konto,
  // imap-only nur das Empfangs-Postfach, full beides.
  const settingsAction = smtpOnly
    ? saveSmtpMailboxAction
    : imapOnly
      ? saveImapMailboxAction
      : saveMailboxCredentialsAction;

  const [state, formAction, isPending] = useActionState(settingsAction, initialState);

  useEffect(() => {
    if (mode === "settings" && state.status === "success" && onSuccess) {
      onSuccess();
    }
  }, [mode, state.status, onSuccess]);

  useEffect(() => {
    if (mode !== "onboarding" || !onDataChange) return;
    // Minimal-Required je nach Anzeige-Modus.
    const minimallyValid = smtpOnly
      ? Boolean(email && smtpHost)
      : imapOnly
        ? Boolean(email && imapHost)
        : Boolean(email && imapHost && smtpHost);
    if (!minimallyValid) {
      onDataChange(null);
    } else {
      onDataChange({
        email,
        password,
        smtpEmail: separateSmtp ? smtpEmail : email,
        smtpPassword: separateSmtp ? smtpPassword : password,
        imapHost,
        imapPort,
        imapSecure,
        smtpHost,
        smtpPort,
        smtpSecure,
        providerId: provider?.id ?? detection?.hosterId ?? null,
      });
    }
  }, [
    mode,
    onDataChange,
    email,
    password,
    imapHost,
    imapPort,
    imapSecure,
    smtpHost,
    smtpPort,
    smtpSecure,
    provider,
    detection,
    separateSmtp,
    smtpEmail,
    smtpPassword,
    smtpOnly,
    imapOnly,
  ]);

  // ── Provider-Erkennung (Domain-Liste) + Hoster-Erkennung (MX-Lookup) ─────────

  function applyServerSettings(s: {
    imap: { host: string; port: number; secure: boolean };
    smtp: { host: string; port: number; secure: boolean };
  }) {
    setImapHost(s.imap.host);
    setImapPort(s.imap.port);
    setSmtpHost(s.smtp.host);
    setSmtpPort(s.smtp.port);
  }

  function applyDetection(d: HosterDetection) {
    setImapHost(d.imapHost);
    setImapPort(d.imapPort);
    setSmtpHost(d.smtpHost);
    setSmtpPort(d.smtpPort);
  }

  function handleEmailChange(value: string) {
    setEmail(value);
    if (settingsTestPhase === "error") {
      setSettingsTestPhase("idle");
      setSettingsTestErrors({});
    }

    const found = detectProvider(value);
    setProvider(found ?? null);

    if (found) {
      // Bekannte Freemail-Domain — sofort konfigurieren, Hintergrund-Erkennung verwerfen.
      setDetection(null);
      setLookupState("idle");
      applyServerSettings(found);
      setShowAdv(false);
    } else if (detection || lookupState !== "idle") {
      // Domain geändert weg von einem Treffer — Auto-Erkennung zurücksetzen,
      // der nächste MX-Lookup folgt beim Verlassen des Felds (onBlur).
      setDetection(null);
      setLookupState("idle");
    }
  }

  async function handleEmailLookup() {
    if (provider) return; // schon per Domain-Liste erkannt
    const at = email.lastIndexOf("@");
    const domain = at >= 0 ? email.slice(at + 1).trim() : "";
    if (domain.length < 3 || !domain.includes(".")) return;
    if (detection) return; // bereits erkannt

    setLookupState("looking");
    try {
      const res = await lookupMailHosterAction(email);
      if (res.status === "found") {
        setDetection(res.detection);
        setLookupState("idle");
        applyDetection(res.detection);
        // Kundenspezifischer Server → Feld zum Eintragen öffnen; sonst eingeklappt.
        setShowAdv(res.detection.hostSource === "user");
      } else {
        // Nichts erkannt → manueller Modus mit Port/Verschlüsselung.
        setDetection(null);
        setLookupState("unknown");
        setImapHost("");
        setSmtpHost("");
        setShowAdv(true);
      }
    } catch {
      setDetection(null);
      setLookupState("unknown");
      setShowAdv(true);
    }
  }

  async function handleSubmitWithTest(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const formData = new FormData(e.currentTarget);

    setSettingsTestPhase("testing");
    setSettingsTestErrors({});

    try {
      // Nur das je nach purpose relevante Protokoll testen. Übersprungene
      // Protokolle zählen als "ok".
      let imapOk = true,
        smtpOk = true;
      let imapErr: string | undefined, smtpErr: string | undefined;

      if (!smtpOnly) {
        const fd = new FormData();
        fd.set("tcImapHost", imapHost);
        fd.set("tcImapPort", String(imapPort));
        fd.set("tcImapSecure", String(imapSecure));
        fd.set("tcImapUser", email);
        fd.set("tcImapPass", password);
        const r = await testImapOnlyConnectionAction(null, fd);
        imapOk = r.ok;
        imapErr = r.error;
      }
      if (!imapOnly) {
        const fd = new FormData();
        fd.set("tcSmtpHost", smtpHost);
        fd.set("tcSmtpPort", String(smtpPort));
        fd.set("tcSmtpSecure", String(smtpSecure));
        fd.set("tcSmtpUser", smtpUsername.trim() || (separateSmtp ? smtpEmail : email));
        fd.set("tcSmtpPass", separateSmtp ? smtpPassword : password);
        const r = await testSmtpOnlyConnectionAction(null, fd);
        smtpOk = r.ok;
        smtpErr = r.error;
      }

      if (imapOk && smtpOk) {
        setSettingsTestPhase("success");
        setTimeout(() => {
          setSettingsTestPhase("idle");
          formAction(formData);
        }, 700);
      } else {
        setSettingsTestPhase("error");
        setSettingsTestErrors({ imap: imapErr, smtp: smtpErr });
        // Auth-Fehler? Server-Details aufklappen — manche Anbieter (z. B. ältere
        // webgo-Postfächer) verlangen einen separaten Benutzernamen statt der E-Mail.
        if (/passwort|auth/i.test(`${imapErr ?? ""} ${smtpErr ?? ""}`)) setShowAdv(true);
      }
    } catch (err) {
      setSettingsTestPhase("error");
      setSettingsTestErrors({
        imap:
          err instanceof Error ? err.message : "Verbindungstest konnte nicht ausgeführt werden.",
      });
    }
  }

  const emailHasDomain = email.includes("@") && email.slice(email.indexOf("@") + 1).length > 0;
  // Ports/Verschlüsselung nur dann manuell zeigen, wenn wir den Hoster NICHT
  // kennen (weder Domain-Provider noch MX-Erkennung) — dort sind die Werte offen.
  const hidePortSsl = Boolean(provider || detection);
  const detectionHint = provider?.hint ?? detection?.hint;
  const detectionAppPasswordUrl = provider?.appPasswordUrl ?? detection?.appPasswordUrl;
  const unsupportedReason = detection?.unsupportedReason;

  // ── Render ────────────────────────────────────────────────────────────────

  const inner = (
    <div className="space-y-4">
      {/* Email */}
      <div>
        <label className="mb-1 block text-xs font-medium text-muted">
          {smtpOnly ? "Absende-Adresse (E-Mail)" : "E-Mail-Adresse (Posteingang)"}
        </label>
        <input
          type="email"
          name={mode === "settings" ? "mailEmail" : undefined}
          value={email}
          onChange={(e) => handleEmailChange(e.target.value)}
          onBlur={handleEmailLookup}
          placeholder="rechnungen@example.com"
          autoComplete="username"
          inputMode="email"
          enterKeyHint="next"
          required
          className="h-9 w-full rounded border border-line bg-surface px-3 text-sm outline-none focus:border-brand focus:ring-2 focus:ring-brand/20"
        />
      </div>

      {/* Hintergrund-Erkennung läuft */}
      {lookupState === "looking" && (
        <div className="flex items-center gap-2 text-xs text-muted">
          <Loader2 size={13} className="animate-spin shrink-0" aria-hidden />
          Anbieter wird erkannt…
        </div>
      )}

      {/* Provider badge — bekannte Freemail-Domain */}
      {provider && (
        <div className="flex items-center gap-2.5 rounded-md border border-ok/20 bg-ok/5 px-3 py-2">
          <VendorLogo domain={provider.domain} name={provider.name} size={20} />
          <span className="text-xs text-ink">
            <span className="font-medium">{provider.name}</span> erkannt — Server automatisch
            konfiguriert.
          </span>
        </div>
      )}

      {/* Hoster badge — eigene Domain per MX erkannt (außer M365-Warnfall) */}
      {!provider && detection && !unsupportedReason && (
        <div className="flex items-center gap-2.5 rounded-md border border-ok/20 bg-ok/5 px-3 py-2">
          <VendorLogo domain={detection.hosterDomain} name={detection.hosterName} size={20} />
          <span className="text-xs text-ink">
            <span className="font-medium">{detection.hosterName}</span>{" "}
            {detection.hostSource === "user"
              ? "erkannt — bitte trag deinen Server unten ein."
              : "erkannt — Server automatisch konfiguriert."}
          </span>
        </div>
      )}

      {/* Unsupported (Microsoft 365) — ehrlich warnen statt still scheitern */}
      {unsupportedReason && (
        <div className="flex items-start gap-2.5 rounded-md border border-warn/30 bg-warn/5 px-3 py-2.5">
          <AlertTriangle size={15} className="mt-0.5 shrink-0 text-warn" aria-hidden />
          <span className="text-xs text-ink">
            <span className="font-medium">{detection?.hosterName} erkannt.</span>{" "}
            {unsupportedReason}
          </span>
        </div>
      )}

      {/* Nichts erkannt — kurzer Hinweis, warum die Felder erscheinen */}
      {lookupState === "unknown" && !provider && emailHasDomain && (
        <p className="text-xs text-muted">
          Anbieter nicht automatisch erkannt — bitte trag die Server-Daten unten ein. Sie stehen
          meist im Kundenportal deines E-Mail-Anbieters.
        </p>
      )}

      {/* ProtonMail Bridge special card */}
      {provider?.id === "protonmail" && (
        <div className="rounded-md border border-line bg-surface px-4 py-3 text-xs">
          <p className="font-medium text-ink">Proton Mail Bridge erforderlich</p>
          <p className="mt-0.5 text-muted">
            Proton Mail verschlüsselt alle E-Mails — externe Apps brauchen die Bridge als lokalen
            Proxy.
          </p>
          <ol className="mt-2.5 space-y-1.5 text-muted">
            <li className="flex gap-2">
              <span className="shrink-0 font-medium text-ink">1.</span>
              <span>
                <a
                  href="https://proton.me/mail/bridge"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="font-medium text-brand hover:underline inline-flex items-center gap-0.5"
                >
                  Proton Mail Bridge herunterladen <ExternalLink size={10} aria-hidden />
                </a>{" "}
                und installieren
              </span>
            </li>
            <li className="flex gap-2">
              <span className="shrink-0 font-medium text-ink">2.</span>
              <span>In der Bridge mit deinem Proton-Konto anmelden</span>
            </li>
            <li className="flex gap-2">
              <span className="shrink-0 font-medium text-ink">3.</span>
              <span>
                Das <strong>Bridge-Passwort</strong> (nicht dein Proton-Login) aus der Bridge-App
                kopieren und unten eingeben
              </span>
            </li>
          </ol>
          <p className="mt-2 text-muted/70">
            IMAP (Port 1143) und SMTP (Port 1025) sind bereits auf die Bridge-Adresse
            voreingestellt.
          </p>
        </div>
      )}

      {/* App-password warning — above the password field so it's read before entry */}
      {provider?.id !== "protonmail" && !unsupportedReason && detectionHint && (
        <div className="rounded-md border border-warn/20 bg-warn/5 px-3 py-2.5 text-xs font-medium text-ink">
          <span className="font-semibold">Wichtig: </span>
          {detectionHint}
          {detectionAppPasswordUrl && (
            <a
              href={detectionAppPasswordUrl}
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
          {provider?.id === "protonmail"
            ? "Bridge-Passwort"
            : detectionHint
              ? "App-Passwort"
              : "Passwort"}
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
        {mode === "settings" && initialEmail && (
          <p className="mt-1 text-[11px] text-muted">
            Dein gespeichertes Passwort wird aus Sicherheitsgründen nicht angezeigt — zum Speichern
            bitte erneut eingeben.
          </p>
        )}
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
        {(provider || detection) && !showAdv && (
          <span className="text-muted/60">· automatisch konfiguriert</span>
        )}
      </button>

      {showAdv && (
        <div className="rounded border border-line/60 bg-surface p-4 space-y-4">
          {/* Login-Name, falls abweichend von der E-Mail (älteres webgo-Postfach
              web000p1, Mittwald pXXXXXXpX). Absende-Konto (smtp-only). Steht vor
              dem Server, weil er zu den Anmeldedaten gehört, nicht zur Technik. */}
          {smtpOnly && (
            <div>
              <div className="mb-1 text-xs font-medium text-muted">
                Benutzername{" "}
                <span className="font-normal text-muted/70">
                  — nur falls abweichend von der E-Mail
                </span>
              </div>
              <input
                value={smtpUsername}
                onChange={(e) => setSmtpUsername(e.target.value)}
                placeholder={email || "z. B. web000p1"}
                autoComplete="off"
                className="h-8 w-full rounded border border-line bg-white px-2 font-mono text-xs outline-none focus:border-brand"
              />
              <p className="mt-1 text-[11px] text-muted">
                Manche Anbieter (ältere webgo-Postfächer, Mittwald) verlangen einen Postfach-Namen
                statt der E-Mail als Benutzernamen.
              </p>
            </div>
          )}

          {/*
            Port + TLS-Modus nur bei UNBEKANNTEM Hoster anzeigen — dort sind die
            Werte offen. Bei erkanntem Provider/Hoster liefern Preset bzw.
            Bibliothek die Ports; gespeicherte Custom-Ports bleiben über die
            Hidden-Felder erhalten, auch wenn das Feld nicht angezeigt wird.
           */}
          {(() => {
            const oneCol = smtpOnly || imapOnly;
            return (
              <div
                className={
                  oneCol ? "grid grid-cols-1 gap-4" : "grid grid-cols-1 gap-4 sm:grid-cols-2"
                }
              >
                {!smtpOnly && (
                  <div>
                    <div className="mb-2 text-xs font-medium text-muted">Empfangs-Server</div>
                    <div className="space-y-1.5">
                      <input
                        value={imapHost}
                        onChange={(e) => setImapHost(e.target.value)}
                        placeholder="imap.example.com"
                        inputMode="url"
                        className="h-8 w-full rounded border border-line bg-white px-2 font-mono text-xs outline-none focus:border-brand"
                      />
                      {!hidePortSsl && (
                        <div className="flex items-center gap-2">
                          <input
                            type="number"
                            value={imapPort}
                            onChange={(e) => setImapPort(Number(e.target.value))}
                            inputMode="numeric"
                            className="h-8 w-20 rounded border border-line bg-white px-2 font-mono text-xs outline-none focus:border-brand"
                          />
                          <span className="text-xs text-muted">
                            {imapSecure ? "verschlüsselt" : "unverschlüsselt"}
                          </span>
                        </div>
                      )}
                    </div>
                  </div>
                )}
                {!imapOnly && (
                  <div>
                    <div className="mb-2 text-xs font-medium text-muted">Versand-Server</div>
                    <div className="space-y-1.5">
                      <input
                        value={smtpHost}
                        onChange={(e) => setSmtpHost(e.target.value)}
                        placeholder="smtp.example.com"
                        inputMode="url"
                        className="h-8 w-full rounded border border-line bg-white px-2 font-mono text-xs outline-none focus:border-brand"
                      />
                      {!hidePortSsl && (
                        <div className="flex items-center gap-2">
                          <input
                            type="number"
                            value={smtpPort}
                            onChange={(e) => setSmtpPort(Number(e.target.value))}
                            inputMode="numeric"
                            className="h-8 w-20 rounded border border-line bg-white px-2 font-mono text-xs outline-none focus:border-brand"
                          />
                          <span className="text-xs text-muted">
                            {smtpSecure ? "verschlüsselt" : "unverschlüsselt"}
                          </span>
                        </div>
                      )}
                    </div>
                  </div>
                )}
              </div>
            );
          })()}

          {/* Separate SMTP credentials — Advanced-Option, im Onboarding
              ausgeblendet (verwirrt mehr als sie hilft); nur im FULL-Modus
              relevant (imap-only/smtp-only konfigurieren je nur ein Protokoll). */}
          {mode !== "onboarding" && !smtpOnly && !imapOnly && (
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
          )}
        </div>
      )}
    </div>
  );

  if (mode === "onboarding") return inner;

  return (
    <form onSubmit={handleSubmitWithTest} noValidate>
      <input type="hidden" name="mailSlot" value={slot} readOnly />
      <input type="hidden" name="imapHost" value={imapHost} readOnly />
      <input type="hidden" name="imapPort" value={imapPort} readOnly />
      <input type="hidden" name="imapSecure" value={String(imapSecure)} readOnly />
      <input type="hidden" name="smtpHost" value={smtpHost} readOnly />
      <input type="hidden" name="smtpPort" value={smtpPort} readOnly />
      <input type="hidden" name="smtpSecure" value={String(smtpSecure)} readOnly />
      {smtpOnly && <input type="hidden" name="smtpUsername" value={smtpUsername} readOnly />}
      {!separateSmtp && <input type="hidden" name="smtpEmail" value={email} readOnly />}
      {!separateSmtp && <input type="hidden" name="smtpPassword" value={password} readOnly />}

      {inner}

      {/* Connection test feedback */}
      {settingsTestPhase === "testing" && (
        <div className="mt-4 flex items-center gap-2 text-sm text-muted">
          <Loader2 size={14} className="animate-spin shrink-0" aria-hidden />
          <span>
            {smtpOnly
              ? "Prüfe Versand-Server…"
              : imapOnly
                ? "Prüfe Empfangs-Server…"
                : "Prüfe Verbindung…"}
          </span>
        </div>
      )}
      {settingsTestPhase === "success" && (
        <div className="mt-4 flex items-center gap-3 text-sm text-ok">
          {!smtpOnly && (
            <span className="flex items-center gap-1">
              <Check size={14} aria-hidden /> Empfang verbunden
            </span>
          )}
          {!imapOnly && (
            <span className="flex items-center gap-1">
              <Check size={14} aria-hidden /> Versand verbunden
            </span>
          )}
        </div>
      )}
      {settingsTestPhase === "error" && (
        <div className="mt-4 rounded-md border border-danger/20 bg-danger/5 px-3 py-2.5 text-sm">
          <p className="flex items-center gap-1.5 font-medium text-danger">
            <WifiOff size={14} aria-hidden /> Verbindung fehlgeschlagen
          </p>
          {settingsTestErrors.imap && (
            <p className="mt-1 text-xs text-danger">
              <strong>Empfang:</strong> {settingsTestErrors.imap}
            </p>
          )}
          {settingsTestErrors.smtp && (
            <p className="mt-1 text-xs text-danger">
              <strong>Versand:</strong> {settingsTestErrors.smtp}
            </p>
          )}
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
          disabled={
            settingsTestPhase === "testing" ||
            settingsTestPhase === "success" ||
            isPending ||
            Boolean(unsupportedReason) ||
            !email ||
            (!smtpOnly && !imapHost) ||
            (!imapOnly && !smtpHost)
          }
          className="inline-flex h-9 items-center gap-2 rounded bg-brand px-4 text-sm font-medium text-white disabled:cursor-not-allowed disabled:opacity-50"
        >
          {settingsTestPhase === "testing" ? (
            <>
              <Loader2 size={14} className="animate-spin" aria-hidden /> Verbindung wird geprüft…
            </>
          ) : settingsTestPhase === "success" ? (
            <>
              <Check size={14} aria-hidden /> Verbunden
            </>
          ) : isPending ? (
            "Speichert…"
          ) : smtpOnly ? (
            "Absende-Konto speichern"
          ) : (
            "Postfach verbinden"
          )}
        </button>
      </div>
    </form>
  );
}
