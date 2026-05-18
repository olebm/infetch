"use client";

import { Fragment, useActionState, useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Image from "next/image";
import { Check, ArrowLeft, ArrowRight, Info, Loader2, WifiOff, ChevronDown, ExternalLink } from "lucide-react";
import { completeOnboardingAction, type OnboardingState } from "@/app/onboarding/actions";
import { testMailConnectionAction } from "@/mail/connection-test";
import { Button } from "@/components/ui/button";
import { VendorLogo } from "@/components/ui/vendor-logo";
import { MailboxConnectContent, type MailboxData } from "@/components/credentials/mailbox-connect-content";
import { RECIPIENTS, type TargetSlot } from "@/lib/recipients";
import { getProviderFromEmail } from "@/lib/mail-providers";

// ─── Types ────────────────────────────────────────────────────────────────────

type WizardData = {
  imapEmail: string;
  imapPassword: string;
  imapHost: string;
  imapPort: number;
  imapSecure: boolean;
  smtpHost: string;
  smtpPort: number;
  smtpSecure: boolean;
  smtpEmail: string;      // SMTP username (may differ from IMAP)
  smtpPassword: string;   // SMTP password (may differ from IMAP)
  recipientName: string;
  recipientEmail: string;
  recipientKey: string;       // selected RECIPIENTS key, or "custom"
  recipientSlot: TargetSlot;  // export slot derived from the selected recipient
  // Optional separate sending mailbox (e.g. the address registered at the tax
  // software). When enabled, invoices are sent from this account instead of
  // the receiving (IMAP) one.
  senderEnabled: boolean;
  senderEmail: string;
  senderPassword: string;
  senderSmtpHost: string;
  senderSmtpPort: number;
  senderSmtpSecure: boolean;
};

// ─── Steps config ─────────────────────────────────────────────────────────────

const STEPS = ["Postfach", "Buchhaltung", "Bestätigung"] as const;

// ─── sessionStorage helpers ───────────────────────────────────────────────────

const STORAGE_KEY = "onboarding-wizard";

type PersistedState = {
  step: number;
  data: Omit<WizardData, "imapPassword" | "smtpPassword" | "senderPassword">;
};

function loadFromStorage(): PersistedState | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = sessionStorage.getItem(STORAGE_KEY);
    return raw ? (JSON.parse(raw) as PersistedState) : null;
  } catch {
    return null;
  }
}

function saveToStorage(step: number, data: WizardData): void {
  if (typeof window === "undefined") return;
  try {
    const { imapPassword: _ip, smtpPassword: _sp, senderPassword: _snp, ...rest } = data;
    sessionStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({ step: Math.min(step, 1), data: rest } satisfies PersistedState),
    );
  } catch {}
}

function clearStorage(): void {
  if (typeof window === "undefined") return;
  try { sessionStorage.removeItem(STORAGE_KEY); } catch {}
}

// ─── Defaults ────────────────────────────────────────────────────────────────

const DEFAULT_DATA: WizardData = {
  imapEmail: "", imapPassword: "",
  imapHost: "", imapPort: 993, imapSecure: true,
  smtpHost: "", smtpPort: 465, smtpSecure: true,
  smtpEmail: "", smtpPassword: "",
  recipientName: "", recipientEmail: "",
  recipientKey: "custom",
  recipientSlot: "kontist",
  senderEnabled: false,
  senderEmail: "", senderPassword: "",
  senderSmtpHost: "", senderSmtpPort: 465, senderSmtpSecure: true,
};

const IMAP_SMTP_DEFAULTS = {
  imapEmail: "", imapPassword: "",
  imapHost: "", imapPort: 993, imapSecure: true,
  smtpHost: "", smtpPort: 465, smtpSecure: true,
  smtpEmail: "", smtpPassword: "",
};

// Effective SMTP/send settings: separate sending mailbox if enabled, else the
// receiving (IMAP) account's SMTP. Used for the connection test and submit.
function effectiveSmtp(d: WizardData): {
  host: string; port: number; secure: boolean; user: string; pass: string;
} {
  if (d.senderEnabled) {
    return {
      host: d.senderSmtpHost,
      port: d.senderSmtpPort,
      secure: d.senderSmtpSecure,
      user: d.senderEmail,
      pass: d.senderPassword,
    };
  }
  return {
    host: d.smtpHost,
    port: d.smtpPort,
    secure: d.smtpSecure,
    user: d.smtpEmail || d.imapEmail,
    pass: d.smtpPassword || d.imapPassword,
  };
}

// ─── Component ────────────────────────────────────────────────────────────────

const initialActionState: OnboardingState = { status: "idle", message: "" };

export function OnboardingWizard() {
  const router = useRouter();

  // SSR-safe: server and first client render must match, so start from
  // defaults and restore sessionStorage only after mount.
  const [step, setStep] = useState(0);
  const [data, setData] = useState<WizardData>(DEFAULT_DATA);
  const [hydrated, setHydrated] = useState(false);

  // One-time client-only restore of persisted wizard state after mount.
  // Intentionally post-render (not a lazy useState initializer) so SSR and the
  // first client render stay identical — otherwise the step indicator hydrates
  // with a mismatch. setState-in-effect is the correct tool for this one-shot
  // hydration; the rule is disabled deliberately, matching repo convention.
  useEffect(() => {
    const saved = loadFromStorage();
    if (saved) {
      const restored = { ...DEFAULT_DATA, ...saved.data, imapPassword: "", smtpPassword: "" };
      // MailboxConnectContent manages its own UI state — clear IMAP/SMTP fields
      // when restoring to step 0 so the component and wizard state stay in sync.
      /* eslint-disable react-hooks/set-state-in-effect */
      setData(saved.step === 0 ? { ...restored, ...IMAP_SMTP_DEFAULTS } : restored);
      setStep(saved.step);
    }
    setHydrated(true);
    /* eslint-enable react-hooks/set-state-in-effect */
  }, []);

  const [actionState, formAction, isPending] = useActionState(
    completeOnboardingAction,
    initialActionState,
  );
  const [validationError, setValidationError] = useState<string | null>(null);

  type TestPhase = "idle" | "testing" | "success" | "error";
  const [testPhase, setTestPhase] = useState<TestPhase>("idle");
  const [testErrors, setTestErrors] = useState<{ imap?: string; smtp?: string }>({});
  const [senderShowAdv, setSenderShowAdv] = useState(false);

  function handleSenderEmailChange(value: string) {
    const provider = getProviderFromEmail(value);
    setData((d) => ({
      ...d,
      senderEmail: value,
      // Auto-fill the send SMTP server from the address' provider. If unknown,
      // keep whatever is there so the manual Server-Details still apply.
      ...(provider
        ? {
            senderSmtpHost: provider.smtp.host,
            senderSmtpPort: provider.smtp.port,
            senderSmtpSecure: provider.smtp.secure,
          }
        : {}),
    }));
  }

  useEffect(() => {
    if (!hydrated) return;
    saveToStorage(step, data);
  }, [hydrated, step, data]);

  const set = (key: keyof WizardData) =>
    (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) =>
      setData((d) => ({ ...d, [key]: e.target.value }));

  const selectedRecipientHint =
    data.recipientKey === "custom"
      ? null
      : RECIPIENTS.find((r) => r.key === data.recipientKey)?.hint ?? null;

  const submitSmtp = effectiveSmtp(data);
  const senderProvider = data.senderEnabled ? getProviderFromEmail(data.senderEmail) : null;

  const next = async () => {
    setValidationError(null);

    if (step === 0) {
      if (!data.imapEmail)    { setValidationError("Bitte E-Mail-Adresse eingeben."); return; }
      if (!data.imapPassword) { setValidationError("Bitte Passwort eingeben."); return; }
      if (!data.imapHost)     { setValidationError("Server-Details fehlen — bitte Provider auswählen oder manuell eingeben."); return; }
      if (data.senderEnabled) {
        if (!data.senderEmail)    { setValidationError("Bitte die abweichende Sende-Adresse eingeben."); return; }
        if (!data.senderPassword) { setValidationError("Bitte das Passwort für die Sende-Adresse eingeben."); return; }
        if (!data.senderSmtpHost) { setValidationError("Sende-Server unbekannt — bitte Server-Details der Sende-Adresse manuell eingeben."); return; }
      }

      setTestPhase("testing");
      setTestErrors({});

      const smtp = effectiveSmtp(data);

      const fd = new FormData();
      fd.set("tcImapHost",   data.imapHost);
      fd.set("tcImapPort",   String(data.imapPort));
      fd.set("tcImapSecure", String(data.imapSecure));
      fd.set("tcImapUser",   data.imapEmail);
      fd.set("tcImapPass",   data.imapPassword);
      fd.set("tcSmtpHost",   smtp.host);
      fd.set("tcSmtpPort",   String(smtp.port));
      fd.set("tcSmtpSecure", String(smtp.secure));
      fd.set("tcSmtpUser",   smtp.user);
      fd.set("tcSmtpPass",   smtp.pass);

      let result: Awaited<ReturnType<typeof testMailConnectionAction>>;
      try {
        result = await testMailConnectionAction(null, fd);
      } catch (e) {
        setTestPhase("error");
        setTestErrors({
          imap: e instanceof Error ? e.message : "Verbindungstest konnte nicht ausgeführt werden.",
        });
        return;
      }

      if (result.imap.ok && result.smtp.ok) {
        setTestPhase("success");
        setTimeout(() => {
          setTestPhase("idle");
          setStep((s) => Math.min(STEPS.length - 1, s + 1));
        }, 900);
      } else {
        setTestPhase("error");
        setTestErrors({
          imap: result.imap.ok ? undefined : result.imap.error,
          smtp: result.smtp.ok ? undefined : result.smtp.error,
        });
      }
      return;
    }

    if (step === 1 && !data.recipientEmail) {
      setValidationError("Bitte Empfänger-Adresse eingeben.");
      return;
    }
    setStep((s) => Math.min(STEPS.length - 1, s + 1));
  };
  const back = () => { setValidationError(null); setTestPhase("idle"); setTestErrors({}); setStep((s) => Math.max(0, s - 1)); };

  // Stable so MailboxConnectContent's data-sync effect doesn't re-fire every render.
  const handleMailboxData = useCallback((d: MailboxData | null) => {
    setTestPhase((p) => (p === "error" ? "idle" : p));
    setTestErrors((e) => (Object.keys(e).length ? {} : e));
    if (d) {
      setData((prev) => ({
        ...prev,
        imapEmail: d.email,
        imapPassword: d.password,
        imapHost: d.imapHost,
        imapPort: d.imapPort,
        imapSecure: d.imapSecure,
        smtpHost: d.smtpHost,
        smtpPort: d.smtpPort,
        smtpSecure: d.smtpSecure,
        smtpEmail: d.smtpEmail,
        smtpPassword: d.smtpPassword,
      }));
    } else {
      setData((prev) => ({ ...prev, ...IMAP_SMTP_DEFAULTS }));
    }
  }, []);

  if (actionState.status === "success") {
    clearStorage();
    router.push("/onboarding/erstabruf");
  }

  return (
    <div className="flex min-h-screen flex-col bg-surface">

      {/* ── Header ────────────────────────────────────────────────────────── */}
      <header className="flex h-14 items-center border-b border-line bg-white px-6">
        <Image
          src="/images/brand/infetch-logo.svg"
          alt="Infetch"
          width={108}
          height={34}
          className="h-[34px] w-auto select-none"
          priority
          draggable={false}
        />
      </header>

      {/* ── Progress ──────────────────────────────────────────────────────── */}
      <div className="mx-auto w-full max-w-2xl px-4 sm:px-6 mt-6 sm:mt-8 mb-2">
        <div className="flex items-center justify-between gap-2">
          {STEPS.map((label, i) => (
            <Fragment key={label}>
              <div className="flex min-w-0 items-center gap-2">
                <div
                  className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-xs font-semibold transition-colors ${
                    i < step
                      ? "bg-ok text-white"
                      : i === step
                        ? "bg-brand text-paper"
                        : "border border-line bg-white text-muted"
                  }`}
                >
                  {i < step ? <Check size={12} /> : i + 1}
                </div>
                <span
                  className={`hidden xs:block truncate text-xs font-medium ${
                    i === step ? "text-ink" : "text-muted"
                  }`}
                >
                  {label}
                </span>
              </div>
              {i < STEPS.length - 1 && (
                <div className={`h-px flex-1 ${i < step ? "bg-ok" : "bg-line"}`} />
              )}
            </Fragment>
          ))}
        </div>
      </div>

      {/* ── Step content ──────────────────────────────────────────────────── */}
      <main className="mx-auto w-full max-w-2xl flex-1 px-4 sm:px-6 py-6 sm:py-8 md:py-12">

        {/* 0 — Postfach */}
        {step === 0 && (
          <div>
            <h1 className="text-2xl font-semibold tracking-tight text-ink md:text-3xl">
              Mit welchem Postfach sollen wir arbeiten?
            </h1>
            <p className="mt-2 text-sm text-muted">
              Drei Schritte, dann scannt Infetch alle 5 Minuten und leitet Rechnungen automatisch weiter.
            </p>
            <div className="mt-6 rounded-md border border-line bg-paper p-5">
              <MailboxConnectContent
                mode="onboarding"
                onDataChange={handleMailboxData}
              />
            </div>

            {/* Optional: separate sending mailbox */}
            <div className="mt-4 rounded-md border border-line bg-paper p-5">
              <label className="flex items-start gap-3 cursor-pointer select-none">
                <input
                  type="checkbox"
                  checked={data.senderEnabled}
                  onChange={(e) => setData((d) => ({ ...d, senderEnabled: e.target.checked }))}
                  className="mt-0.5"
                />
                <span>
                  <span className="block text-sm font-medium text-ink">
                    Rechnungen von einer anderen Adresse senden
                  </span>
                  <span className="mt-0.5 block text-xs text-muted">
                    Falls deine Buchhaltungs-Software nur Belege von einer bestimmten Adresse akzeptiert
                    (z. B. der dort hinterlegten E-Mail). Empfang bleibt das Postfach oben.
                  </span>
                </span>
              </label>

              {data.senderEnabled && (
                <div className="mt-4 space-y-4 border-t border-line/60 pt-4">
                  <div>
                    <label className="mb-1 block text-xs font-medium text-muted">
                      Sende-Adresse
                    </label>
                    <input
                      type="email"
                      value={data.senderEmail}
                      onChange={(e) => handleSenderEmailChange(e.target.value)}
                      placeholder="versand@example.com"
                      autoComplete="username"
                      inputMode="email"
                      className="h-9 w-full rounded border border-line bg-surface px-3 text-sm outline-none focus:border-brand focus:ring-2 focus:ring-brand/20"
                    />
                  </div>

                  {senderProvider && (
                    <div className="flex items-center gap-2.5 rounded-md border border-ok/20 bg-ok/5 px-3 py-2">
                      <VendorLogo domain={senderProvider.domain} name={senderProvider.name} size={20} />
                      <span className="text-xs text-ink">
                        <span className="font-medium">{senderProvider.name}</span>
                        {" "}erkannt — Sende-Server automatisch konfiguriert.
                      </span>
                    </div>
                  )}

                  {senderProvider?.hint && (
                    <div className="rounded-md border border-warn/20 bg-warn/5 px-3 py-2.5 text-xs text-ink">
                      <span className="font-medium">Wichtig: </span>
                      {senderProvider.hint}
                      {senderProvider.appPasswordUrl && (
                        <a
                          href={senderProvider.appPasswordUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="ml-1.5 inline-flex items-center gap-0.5 font-medium text-brand hover:underline"
                        >
                          App-Passwort erstellen <ExternalLink size={10} aria-hidden />
                        </a>
                      )}
                    </div>
                  )}

                  <div>
                    <label className="mb-1 block text-xs font-medium text-muted">
                      {senderProvider?.hint ? "App-Passwort" : "Passwort"}
                    </label>
                    <input
                      type="password"
                      value={data.senderPassword}
                      onChange={set("senderPassword")}
                      placeholder="•••• •••• •••• ••••"
                      autoComplete="new-password"
                      className="h-9 w-full rounded border border-line bg-surface px-3 text-sm outline-none focus:border-brand focus:ring-2 focus:ring-brand/20"
                    />
                  </div>

                  <button
                    type="button"
                    onClick={() => setSenderShowAdv((v) => !v)}
                    className="inline-flex items-center gap-1.5 text-xs text-muted hover:text-ink"
                  >
                    <ChevronDown
                      size={13}
                      className={`transition-transform ${senderShowAdv ? "rotate-180" : ""}`}
                      aria-hidden
                    />
                    Server-Details
                    {senderProvider && !senderShowAdv && (
                      <span className="text-muted/60">· automatisch konfiguriert</span>
                    )}
                  </button>

                  {senderShowAdv && (
                    <div className="rounded border border-line/60 bg-surface p-4">
                      <div className="mb-2 text-xs font-medium text-muted">SMTP — Versand-Server</div>
                      <div className="space-y-1.5">
                        <input
                          value={data.senderSmtpHost}
                          onChange={(e) => setData((d) => ({ ...d, senderSmtpHost: e.target.value }))}
                          placeholder="smtp.example.com"
                          inputMode="url"
                          className="h-8 w-full rounded border border-line bg-white px-2 font-mono text-xs outline-none focus:border-brand"
                        />
                        <div className="flex items-center gap-2">
                          <input
                            type="number"
                            value={data.senderSmtpPort}
                            onChange={(e) => setData((d) => ({ ...d, senderSmtpPort: Number(e.target.value) }))}
                            inputMode="numeric"
                            className="h-8 w-20 rounded border border-line bg-white px-2 font-mono text-xs outline-none focus:border-brand"
                          />
                          <label className="flex items-center gap-1.5 text-xs text-muted cursor-pointer">
                            <input
                              type="checkbox"
                              checked={data.senderSmtpSecure}
                              onChange={(e) => setData((d) => ({ ...d, senderSmtpSecure: e.target.checked }))}
                            />
                            SSL/TLS
                          </label>
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>
        )}

        {/* 1 — Buchhaltung */}
        {step === 1 && (
          <div>
            <h1 className="text-2xl font-semibold tracking-tight text-ink md:text-3xl">
              Wer bekommt die Rechnungen?
            </h1>
            <p className="mt-2 text-sm text-muted">
              Z. B. deine Steuerkanzlei, ein Buchhaltungs-Tool oder ein interner Account. Später weitere hinzufügbar.
            </p>

            <div className="mt-6 rounded-md border border-line bg-paper p-5 space-y-5">
              {/* Recipient picker */}
              <div>
                <p className="mb-3 text-xs text-muted">
                  Buchhaltungs-Software wählen — bekannte Adressen werden automatisch eingetragen:
                </p>
                <div className="grid grid-cols-3 gap-2 sm:grid-cols-4">
                  {RECIPIENTS.map((r) => {
                    const isActive = data.recipientKey === r.key;
                    return (
                      <button
                        key={r.key}
                        type="button"
                        onClick={() =>
                          setData((d) => ({
                            ...d,
                            recipientKey: r.key,
                            recipientSlot: r.slot,
                            recipientName: r.label,
                            recipientEmail: r.email,
                          }))
                        }
                        className={`flex flex-col items-center gap-2 rounded-md border p-3 text-center transition-colors ${
                          isActive
                            ? "border-brand bg-brand/5"
                            : "border-line bg-paper hover:border-brand/50 hover:bg-surface"
                        }`}
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
                        <span className={`text-[11px] ${isActive ? "font-medium text-brand" : "text-muted"}`}>
                          {r.label}
                        </span>
                      </button>
                    );
                  })}
                  {/* Custom — the optional fallback */}
                  <button
                    type="button"
                    onClick={() =>
                      setData((d) => ({
                        ...d,
                        recipientKey: "custom",
                        recipientSlot: "kontist",
                        recipientName: "",
                        recipientEmail: "",
                      }))
                    }
                    className={`flex flex-col items-center gap-2 rounded-md border p-3 text-center transition-colors ${
                      data.recipientKey === "custom"
                        ? "border-brand bg-brand/5"
                        : "border-dashed border-line bg-paper hover:border-brand/50 hover:bg-surface"
                    }`}
                  >
                    <div className="flex h-7 w-7 items-center justify-center rounded border border-line bg-surface text-sm text-muted">
                      +
                    </div>
                    <span className="text-[11px] text-muted">Eigener</span>
                  </button>
                </div>
              </div>

              {/* Name + e-mail */}
              <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                {data.recipientKey === "custom" && (
                  <div>
                    <label className="mb-1 block text-xs font-medium text-muted">Name</label>
                    <input
                      type="text"
                      value={data.recipientName}
                      onChange={set("recipientName")}
                      placeholder="Steuerkanzlei Müller"
                      className="h-9 w-full rounded border border-line bg-surface px-3 text-sm outline-none focus:border-brand focus:ring-2 focus:ring-brand/20"
                    />
                  </div>
                )}
                <div className={data.recipientKey === "custom" ? "" : "md:col-span-2"}>
                  <label className="mb-1 block text-xs font-medium text-muted">E-Mail-Adresse</label>
                  <input
                    type="email"
                    value={data.recipientEmail}
                    onChange={set("recipientEmail")}
                    placeholder="buchhaltung@beispiel.de"
                    className="h-9 w-full rounded border border-line bg-surface px-3 font-mono text-sm outline-none focus:border-brand focus:ring-2 focus:ring-brand/20"
                  />
                  {selectedRecipientHint && (
                    <p className="mt-1.5 text-xs text-muted">{selectedRecipientHint}</p>
                  )}
                </div>
              </div>
            </div>
          </div>
        )}

        {/* 2 — Bestätigung */}
        {step === 2 && (
          <div>
            <h1 className="text-2xl font-semibold tracking-tight text-ink md:text-3xl">
              Alles bereit — kurze Zusammenfassung.
            </h1>

            <dl className="mt-6 divide-y divide-line rounded-md border border-line bg-paper">
              <div className="flex items-baseline gap-3 px-4 py-3">
                <dt className="w-28 shrink-0 text-xs text-muted">Posteingang</dt>
                <dd className="text-sm text-ink">{data.imapEmail || "IMAP-Zugang"}</dd>
              </div>
              {data.senderEnabled && data.senderEmail && (
                <div className="flex items-baseline gap-3 px-4 py-3">
                  <dt className="w-28 shrink-0 text-xs text-muted">Versand</dt>
                  <dd className="text-sm text-ink font-mono">{data.senderEmail}</dd>
                </div>
              )}
              <div className="flex items-baseline gap-3 px-4 py-3">
                <dt className="w-28 shrink-0 text-xs text-muted">Empfänger</dt>
                <dd className="text-sm text-ink font-mono">
                  {data.recipientEmail || <span className="text-muted italic">nicht angegeben</span>}
                </dd>
              </div>
              {data.recipientName && (
                <div className="flex items-baseline gap-3 px-4 py-3">
                  <dt className="w-28 shrink-0 text-xs text-muted">Name</dt>
                  <dd className="text-sm text-ink">{data.recipientName}</dd>
                </div>
              )}
            </dl>

            <div className="mt-4 flex items-start gap-3 rounded-md border border-brand/20 bg-brand-soft p-4">
              <Info size={16} className="mt-0.5 shrink-0 text-brand" aria-hidden />
              <div className="text-sm text-ink">
                <div className="font-medium">Du kannst jederzeit aussteigen.</div>
                <div className="mt-0.5 text-muted">
                  In den Einstellungen pausieren, Empfänger anpassen oder Konto schließen.
                </div>
              </div>
            </div>

            {actionState.status === "error" && (
              <div className="mt-4 rounded-md border border-danger/20 bg-danger-soft p-3 text-sm text-danger">
                {actionState.message}
              </div>
            )}
          </div>
        )}

        {/* ── Validation error ──────────────────────────────────────────── */}
        {validationError && (
          <p className="mt-4 text-sm text-danger">{validationError}</p>
        )}

        {/* ── Connection test feedback ───────────────────────────────── */}
        {testPhase === "testing" && (
          <div className="mt-4 flex items-center gap-2 text-sm text-muted">
            <Loader2 size={14} className="animate-spin shrink-0" aria-hidden />
            <span>Prüfe IMAP und SMTP…</span>
          </div>
        )}
        {testPhase === "success" && (
          <div className="mt-4 flex items-center gap-3 text-sm text-ok">
            <span className="flex items-center gap-1"><Check size={14} aria-hidden /> IMAP verbunden</span>
            <span className="flex items-center gap-1"><Check size={14} aria-hidden /> SMTP verbunden</span>
          </div>
        )}
        {testPhase === "error" && (
          <div className="mt-4 rounded-md border border-danger/20 bg-danger/5 px-3 py-2.5 text-sm">
            <p className="flex items-center gap-1.5 font-medium text-danger">
              <WifiOff size={14} aria-hidden /> Verbindung fehlgeschlagen
            </p>
            {testErrors.imap && <p className="mt-1 text-xs text-danger"><strong>IMAP:</strong> {testErrors.imap}</p>}
            {testErrors.smtp && <p className="mt-1 text-xs text-danger"><strong>SMTP:</strong> {testErrors.smtp}</p>}
          </div>
        )}

        {/* ── Footer nav ────────────────────────────────────────────────── */}
        <div className="mt-6 flex items-center justify-between">
          <Button variant="ghost" onClick={back} disabled={step === 0 || testPhase === "testing"} className="gap-1.5">
            <ArrowLeft size={16} aria-hidden /> zurück
          </Button>

          {step < STEPS.length - 1 ? (
            <Button
              onClick={next}
              disabled={testPhase === "testing" || testPhase === "success"}
              className="gap-1.5"
            >
              {testPhase === "testing" ? (
                <><Loader2 size={16} className="animate-spin" aria-hidden /> Wird geprüft…</>
              ) : testPhase === "success" ? (
                <><Check size={16} aria-hidden /> Verbunden</>
              ) : (
                <>weiter <ArrowRight size={16} aria-hidden /></>
              )}
            </Button>
          ) : (
            <form action={formAction}>
              <input type="hidden" name="email"          value={data.imapEmail} />
              <input type="hidden" name="password"       value={data.imapPassword} />
              <input type="hidden" name="imapHost"       value={data.imapHost} />
              <input type="hidden" name="imapPort"       value={data.imapPort} />
              <input type="hidden" name="imapSecure"     value={String(data.imapSecure)} />
              <input type="hidden" name="smtpHost"       value={submitSmtp.host} />
              <input type="hidden" name="smtpPort"       value={submitSmtp.port} />
              <input type="hidden" name="smtpSecure"     value={String(submitSmtp.secure)} />
              <input type="hidden" name="smtpEmail"      value={submitSmtp.user} />
              <input type="hidden" name="smtpPassword"   value={submitSmtp.pass} />
              <input type="hidden" name="recipientEmail" value={data.recipientEmail} />
              <input type="hidden" name="exportTarget"   value={data.recipientSlot} />
              <Button type="submit" disabled={isPending} className="gap-1.5">
                {isPending ? "Wird eingerichtet…" : <><span>Setup abschließen</span><ArrowRight size={16} aria-hidden /></>}
              </Button>
            </form>
          )}
        </div>
      </main>
    </div>
  );
}
