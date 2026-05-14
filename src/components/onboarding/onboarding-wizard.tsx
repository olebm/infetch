"use client";

import { Fragment, useActionState, useState } from "react";
import { useRouter } from "next/navigation";
import Image from "next/image";
import { Check, CheckCircle, ChevronRight, ArrowLeft, ArrowRight, AlertTriangle, Info } from "lucide-react";
import { completeOnboardingAction, saveRecipientOnlyAction, type OnboardingState } from "@/app/onboarding/actions";
import { Button } from "@/components/ui/button";
import { CopyField } from "@/components/ui/copy-field";
import { MailboxConnectContent, type MailboxData } from "@/components/credentials/mailbox-connect-content";

// ─── Types ────────────────────────────────────────────────────────────────────

type Method = "inbound" | "imap";

type WizardData = {
  method: Method;
  // IMAP/SMTP — filled by MailboxConnectContent in onboarding mode
  imapEmail: string;
  imapPassword: string;
  imapHost: string;
  imapPort: number;
  imapSecure: boolean;
  smtpHost: string;
  smtpPort: number;
  smtpSecure: boolean;
  // Recipient
  recipientName: string;
  recipientEmail: string;
  recipientTemplate: string;
  subjectTemplate: string;
};

// ─── Steps config ─────────────────────────────────────────────────────────────

const STEPS = ["Willkommen", "Postfach", "Buchhaltung", "Bestätigung"] as const;

const TEMPLATES: Record<string, { name: string; email: string }> = {
  custom:      { name: "",                    email: "" },
  kontist:     { name: "Kontist Belegupload", email: "belege@kontist.com" },
  accountable: { name: "Accountable",         email: "belege@accountable.de" },
  datev:       { name: "DATEV Unternehmen",   email: "" },
};

const PERMISSIONS = [
  ["Deine Inbound-Adresse überwachen",
   "alle 5 Min · nur Mails mit Rechnungsmerkmalen"],
  ["Rechnungs-Daten extrahieren",
   "über unser DSGVO-konformes EU-Modell · ≥ 90 % Konfidenz wird durchgewunken"],
  ["Erkannte Rechnungen weiterleiten",
   "mit PDF im Anhang · klarer Betreff"],
  ["Unsichere Fälle hier zeigen",
   "du entscheidest in < 30 Sek"],
] as const;

// ─── Component ────────────────────────────────────────────────────────────────

const initialActionState: OnboardingState = { status: "idle", message: "" };

export function OnboardingWizard({ inboundAddress }: { inboundAddress: string | null }) {
  const router = useRouter();
  const [step, setStep] = useState(0);
  const [data, setData] = useState<WizardData>({
    method: "inbound",
    imapEmail: "",
    imapPassword: "",
    imapHost: "",
    imapPort: 993,
    imapSecure: true,
    smtpHost: "",
    smtpPort: 465,
    smtpSecure: true,
    recipientName: "",
    recipientEmail: "",
    recipientTemplate: "custom",
    subjectTemplate: "[Rechnung] {{vendor}} · {{date}} · {{amount}}",
  });
  const [actionState, formAction, isPending] = useActionState(
    completeOnboardingAction,
    initialActionState,
  );
  const [inboundState, inboundFormAction, inboundPending] = useActionState(
    saveRecipientOnlyAction,
    initialActionState,
  );
  const [validationError, setValidationError] = useState<string | null>(null);

  const set = (key: keyof WizardData) =>
    (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) =>
      setData((d) => ({ ...d, [key]: e.target.value }));

  const next = () => {
    setValidationError(null);
    if (step === 1 && data.method === "imap") {
      if (!data.imapEmail) { setValidationError("Bitte E-Mail-Adresse eingeben."); return; }
      if (!data.imapHost)  { setValidationError("Bitte Postfach-Anbieter auswählen oder IMAP-Host eingeben."); return; }
    }
    if (step === 2 && !data.recipientEmail) {
      setValidationError("Bitte Empfänger-Adresse eingeben.");
      return;
    }
    setStep((s) => Math.min(STEPS.length - 1, s + 1));
  };
  const back = () => { setValidationError(null); setStep((s) => Math.max(0, s - 1)); };

  if (actionState.status === "success" || inboundState.status === "success") {
    router.push("/onboarding/erstabruf");
  }

  return (
    <div className="flex min-h-screen flex-col bg-surface">

      {/* ── Header ────────────────────────────────────────────────────────── */}
      <header className="flex h-14 items-center justify-between border-b border-line bg-white px-6">
        <div className="flex items-center">
          <Image
            src="/infetch-logo.svg"
            alt="Infetch"
            width={108}
            height={34}
            className="h-[34px] w-auto select-none"
            priority
            draggable={false}
          />
        </div>
        <button
          onClick={() => router.push("/")}
          className="text-xs text-muted hover:text-ink"
        >
          Setup unterbrechen
        </button>
      </header>

      {/* ── Progress ──────────────────────────────────────────────────────── */}
      <div className="mx-auto w-full max-w-2xl px-6 mt-8 mb-2">
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
                  className={`hidden sm:block truncate text-xs font-medium ${
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
      <main className="mx-auto w-full max-w-2xl flex-1 px-6 py-8 md:py-12">

        {/* 0 — Willkommen */}
        {step === 0 && (
          <div>
            <h1 className="text-xl font-semibold tracking-tight text-ink leading-tight sm:text-3xl md:text-4xl">
              Willkommen. Drei Minuten —<br />dann kümmern wir uns.
            </h1>
            <p className="mt-3 text-base text-muted max-w-lg">
              Wir verbinden ein Postfach mit deinem Buchhaltungs-Empfänger. Danach scannen wir alle
              5 Min, erkennen Rechnungen und leiten sie automatisch weiter. Unsichere Fälle fragen
              wir kurz.
            </p>
            <ul className="mt-6 space-y-3">
              {[
                "Wir lesen nur Anhänge mit Rechnungsmerkmalen — kein Bulk-Scan.",
                "PDFs bleiben in deiner SQLite. Nur strukturierte Felder verlassen das Gerät.",
                "Du kannst jederzeit auf manuellen Modus wechseln.",
              ].map((t) => (
                <li key={t} className="flex items-start gap-3">
                  <Check size={16} className="mt-0.5 shrink-0 text-ok" />
                  <span className="text-sm text-ink/90">{t}</span>
                </li>
              ))}
            </ul>
          </div>
        )}

        {/* 1 — Postfach */}
        {step === 1 && (
          <div>
            <h1 className="text-2xl font-semibold tracking-tight text-ink md:text-3xl">
              Mit welchem Postfach sollen wir arbeiten?
            </h1>
            <p className="mt-2 text-sm text-muted">
              Empfehlung: leite Rechnungen an deine private Inbound-Adresse weiter. Sicherer als
              IMAP-Zugang.
            </p>

            {/* Inbound card */}
            <div
              onClick={() => setData((d) => ({ ...d, method: "inbound" }))}
              className={`mt-6 cursor-pointer rounded-md border p-5 transition-colors ${
                data.method === "inbound"
                  ? "border-brand ring-2 ring-brand/20 bg-paper"
                  : "border-line bg-paper hover:bg-surface"
              }`}
            >
              <div className="flex items-start gap-3">
                <input
                  type="radio"
                  readOnly
                  checked={data.method === "inbound"}
                  className="mt-1 accent-brand"
                />
                <div className="flex-1 min-w-0">
                  <div className="flex flex-wrap items-center gap-2 text-sm font-medium text-ink">
                    Eigene Inbound-Adresse
                    <span className="inline-flex items-center gap-1 rounded-full bg-ok-soft px-2 py-0.5 text-[11px] font-medium text-ok">
                      empfohlen
                    </span>
                  </div>
                  <p className="mt-1 text-xs text-muted">
                    Du leitest Rechnungen einfach hierher weiter. Kein Passwort, keine OAuth.
                  </p>
                  {inboundAddress ? (
                    <div className="mt-3">
                      <CopyField label="Deine Inbound-Adresse" value={inboundAddress} />
                    </div>
                  ) : (
                    <p className="mt-2 text-xs text-muted italic">
                      Adresse wird nach der Einrichtung angezeigt.
                    </p>
                  )}
                  <p className="mt-2 text-xs text-muted">
                    Tipp: in Gmail/Outlook eine Weiterleitungsregel für „Rechnung", „Invoice", „Beleg" anlegen.
                  </p>
                </div>
              </div>
            </div>

            {/* IMAP toggle */}
            <button
              onClick={() =>
                setData((d) => ({ ...d, method: d.method === "imap" ? "inbound" : "imap" }))
              }
              className="mt-4 inline-flex items-center gap-1 text-sm text-muted hover:text-ink"
            >
              <ChevronRight
                size={14}
                className={`transition-transform ${data.method === "imap" ? "rotate-90" : ""}`}
              />
              Andere Optionen (IMAP-Zugang)
            </button>

            {data.method === "imap" && (
              <div className="mt-3 rounded-md border border-line bg-paper p-5">
                <div className="mb-4 flex items-start gap-2 text-xs text-warn">
                  <AlertTriangle size={14} className="mt-0.5 shrink-0" aria-hidden />
                  <span>IMAP gibt uns Lesezugriff auf alle Mails. Nur nutzen, wenn Weiterleitung wirklich nicht geht.</span>
                </div>
                <MailboxConnectContent
                  mode="onboarding"
                  onDataChange={(d: MailboxData | null) => {
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
                      }));
                    } else {
                      setData((prev) => ({
                        ...prev,
                        imapEmail: "",
                        imapPassword: "",
                        imapHost: "",
                        imapPort: 993,
                        imapSecure: true,
                        smtpHost: "",
                        smtpPort: 465,
                        smtpSecure: true,
                      }));
                    }
                  }}
                />
              </div>
            )}
          </div>
        )}

        {/* 2 — Buchhaltung */}
        {step === 2 && (
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

        {/* 3 — Bestätigung */}
        {step === 3 && (
          <div>
            <h1 className="text-2xl font-semibold tracking-tight text-ink md:text-3xl">
              Alles bereit — kurze Zusammenfassung.
            </h1>

            {/* Summary */}
            <dl className="mt-6 divide-y divide-line rounded-md border border-line bg-paper">
              <div className="flex items-baseline gap-3 px-4 py-3">
                <dt className="w-28 shrink-0 text-xs text-muted">Postfach</dt>
                <dd className="text-sm text-ink">
                  {data.method === "inbound"
                    ? "Inbound-Weiterleitung (empfohlen)"
                    : data.imapEmail || "IMAP-Zugang"}
                </dd>
              </div>
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

            {(actionState.status === "error" || inboundState.status === "error") && (
              <div className="mt-4 rounded-md border border-danger/20 bg-danger-soft p-3 text-sm text-danger">
                {actionState.status === "error" ? actionState.message : inboundState.message}
              </div>
            )}
          </div>
        )}

        {/* ── Validation error ──────────────────────────────────────────── */}
        {validationError && (
          <p className="mt-4 text-sm text-danger">{validationError}</p>
        )}

        {/* ── Footer nav ────────────────────────────────────────────────── */}
        <div className="mt-6 flex items-center justify-between">
          <Button variant="ghost" onClick={back} disabled={step === 0} className="gap-1.5">
            <ArrowLeft size={16} aria-hidden /> zurück
          </Button>

          {step < STEPS.length - 1 ? (
            <Button onClick={next} className="gap-1.5">
              weiter <ArrowRight size={16} aria-hidden />
            </Button>
          ) : data.method === "inbound" ? (
            <form action={inboundFormAction}>
              <input type="hidden" name="recipientEmail" value={data.recipientEmail} />
              <input type="hidden" name="exportTarget"   value={data.recipientTemplate} />
              <Button type="submit" disabled={inboundPending} className="gap-1.5">
                {inboundPending ? "Wird gespeichert…" : <><span>Setup abschließen</span><ArrowRight size={16} aria-hidden /></>}
              </Button>
            </form>
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
