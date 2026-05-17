"use client";

import { Fragment, useActionState, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Image from "next/image";
import { Check, ArrowLeft, ArrowRight, Info, Loader2, WifiOff } from "lucide-react";
import { completeOnboardingAction, type OnboardingState } from "@/app/onboarding/actions";
import { testMailConnectionAction } from "@/mail/connection-test";
import { Button } from "@/components/ui/button";
import { MailboxConnectContent, type MailboxData } from "@/components/credentials/mailbox-connect-content";

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
  recipientTemplate: string;
  subjectTemplate: string;
};

// ─── Steps config ─────────────────────────────────────────────────────────────

const STEPS = ["Postfach", "Buchhaltung", "Bestätigung"] as const;

const TEMPLATES: Record<string, { name: string; email: string }> = {
  custom:      { name: "",                    email: "" },
  kontist:     { name: "Kontist Belegupload", email: "belege@kontist.com" },
  accountable: { name: "Accountable",         email: "belege@accountable.de" },
  datev:       { name: "DATEV Unternehmen",   email: "" },
};

// ─── sessionStorage helpers ───────────────────────────────────────────────────

const STORAGE_KEY = "onboarding-wizard";

type PersistedState = {
  step: number;
  data: Omit<WizardData, "imapPassword" | "smtpPassword">;
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
    const { imapPassword: _ip, smtpPassword: _sp, ...rest } = data;
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
  recipientTemplate: "custom",
  subjectTemplate: "[Rechnung] {{vendor}} · {{date}} · {{amount}}",
};

const IMAP_SMTP_DEFAULTS = {
  imapEmail: "", imapPassword: "",
  imapHost: "", imapPort: 993, imapSecure: true,
  smtpHost: "", smtpPort: 465, smtpSecure: true,
  smtpEmail: "", smtpPassword: "",
};

// ─── Component ────────────────────────────────────────────────────────────────

const initialActionState: OnboardingState = { status: "idle", message: "" };

export function OnboardingWizard() {
  const router = useRouter();

  const [step, setStep] = useState(() => loadFromStorage()?.step ?? 0);
  const [data, setData] = useState<WizardData>(() => {
    const saved = loadFromStorage();
    if (!saved) return DEFAULT_DATA;
    const restored = { ...DEFAULT_DATA, ...saved.data, imapPassword: "", smtpPassword: "" };
    // MailboxConnectContent manages its own UI state — clear IMAP/SMTP fields
    // when restoring to step 0 so the component and wizard state stay in sync.
    if (saved.step === 0) return { ...restored, ...IMAP_SMTP_DEFAULTS };
    return restored;
  });

  const [actionState, formAction, isPending] = useActionState(
    completeOnboardingAction,
    initialActionState,
  );
  const [validationError, setValidationError] = useState<string | null>(null);

  type TestPhase = "idle" | "testing" | "success" | "error";
  const [testPhase, setTestPhase] = useState<TestPhase>("idle");
  const [testErrors, setTestErrors] = useState<{ imap?: string; smtp?: string }>({});

  useEffect(() => {
    saveToStorage(step, data);
  }, [step, data]);

  const set = (key: keyof WizardData) =>
    (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) =>
      setData((d) => ({ ...d, [key]: e.target.value }));

  const next = async () => {
    setValidationError(null);

    if (step === 0) {
      if (!data.imapEmail)    { setValidationError("Bitte E-Mail-Adresse eingeben."); return; }
      if (!data.imapPassword) { setValidationError("Bitte Passwort eingeben."); return; }
      if (!data.imapHost)     { setValidationError("Server-Details fehlen — bitte Provider auswählen oder manuell eingeben."); return; }

      setTestPhase("testing");
      setTestErrors({});

      const fd = new FormData();
      fd.set("tcImapHost",   data.imapHost);
      fd.set("tcImapPort",   String(data.imapPort));
      fd.set("tcImapSecure", String(data.imapSecure));
      fd.set("tcImapUser",   data.imapEmail);
      fd.set("tcImapPass",   data.imapPassword);
      fd.set("tcSmtpHost",   data.smtpHost);
      fd.set("tcSmtpPort",   String(data.smtpPort));
      fd.set("tcSmtpSecure", String(data.smtpSecure));
      fd.set("tcSmtpUser",   data.smtpEmail || data.imapEmail);
      fd.set("tcSmtpPass",   data.smtpPassword || data.imapPassword);

      const result = await testMailConnectionAction(null, fd);

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
                onDataChange={(d: MailboxData | null) => {
                  if (testPhase === "error") { setTestPhase("idle"); setTestErrors({}); }
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
                }}
              />
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

            <div className="mt-6 rounded-md border border-line bg-paper p-5 space-y-4">
              <div>
                <label className="mb-1 block text-xs font-medium text-muted">Vorlage</label>
                <select
                  value={data.recipientTemplate}
                  onChange={(e) => {
                    const t = e.target.value;
                    const tpl = TEMPLATES[t] ?? TEMPLATES.custom;
                    setData((d) => ({
                      ...d,
                      recipientTemplate: t,
                      recipientName: tpl.name || d.recipientName,
                      recipientEmail: tpl.email || d.recipientEmail,
                    }));
                  }}
                  className="h-9 w-full rounded border border-line bg-surface px-3 text-sm outline-none focus:border-brand"
                >
                  <option value="custom">Eigener Empfänger</option>
                  <option value="kontist">Kontist · Belegupload</option>
                  <option value="accountable">Accountable · Belegmail</option>
                  <option value="datev">DATEV Unternehmen online</option>
                </select>
              </div>
              <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
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
                <div>
                  <label className="mb-1 block text-xs font-medium text-muted">E-Mail</label>
                  <input
                    type="email"
                    value={data.recipientEmail}
                    onChange={set("recipientEmail")}
                    placeholder="kanzlei@beispiel.de"
                    className="h-9 w-full rounded border border-line bg-surface px-3 font-mono text-sm outline-none focus:border-brand focus:ring-2 focus:ring-brand/20"
                  />
                </div>
              </div>
              <div>
                <div className="mb-1 flex items-baseline justify-between">
                  <label className="text-xs font-medium text-muted">Betreff-Schema</label>
                  <span className="text-[11px] text-muted">optional</span>
                </div>
                <input
                  type="text"
                  value={data.subjectTemplate}
                  onChange={set("subjectTemplate")}
                  placeholder="[Rechnung] {{vendor}} · {{date}} · {{amount}}"
                  className="h-9 w-full rounded border border-line bg-surface px-3 font-mono text-sm outline-none focus:border-brand focus:ring-2 focus:ring-brand/20"
                />
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
              {data.smtpEmail && data.smtpEmail !== data.imapEmail && (
                <div className="flex items-baseline gap-3 px-4 py-3">
                  <dt className="w-28 shrink-0 text-xs text-muted">Versand</dt>
                  <dd className="text-sm text-ink font-mono">{data.smtpEmail}</dd>
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
              <input type="hidden" name="smtpHost"       value={data.smtpHost} />
              <input type="hidden" name="smtpPort"       value={data.smtpPort} />
              <input type="hidden" name="smtpSecure"     value={String(data.smtpSecure)} />
              <input type="hidden" name="smtpEmail"      value={data.smtpEmail} />
              <input type="hidden" name="smtpPassword"   value={data.smtpPassword} />
              <input type="hidden" name="recipientEmail" value={data.recipientEmail} />
              <input type="hidden" name="exportTarget"   value={data.recipientTemplate} />
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
