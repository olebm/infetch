"use client";

import { Fragment, useActionState, useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Image from "next/image";
import { Check, ArrowLeft, ArrowRight, Info, Loader2, WifiOff } from "lucide-react";
import { completeOnboardingAction, type OnboardingState } from "@/app/onboarding/actions";
import { logout } from "@/app/login/actions";
import { testMailConnectionAction } from "@/mail/connection-test";
import { Button } from "@/components/ui/button";
import { VendorLogo } from "@/components/ui/vendor-logo";
import { MailboxConnectContent, type MailboxData } from "@/components/credentials/mailbox-connect-content";
import { RECIPIENTS, type TargetSlot, isSharedInboxRecipient } from "@/lib/recipients";

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
  // Separate sending mailbox — the address registered at the accounting
  // software. Only collected (and mandatory) for shared-inbox recipients;
  // then invoices are sent from this account instead of the receiving one.
  senderEmail: string;
  senderPassword: string;
  senderSmtpHost: string;
  senderSmtpPort: number;
  senderSmtpSecure: boolean;
};

// ─── Steps config ─────────────────────────────────────────────────────────────

type StepKey = "postfach" | "buchhaltung" | "versand" | "bestaetigung";

const STEP_LABELS: Record<StepKey, string> = {
  postfach: "Postfach",
  buchhaltung: "Buchhaltung",
  versand: "Versand",
  bestaetigung: "Bestätigung",
};

// Wizard 3- oder 4-stufig (Iteration 3, INFETCH-187):
//   1. Postfach     — nur IMAP (Empfangs-Server)
//   2. Empfänger    — Buchhaltungs-Software oder Steuerkanzlei-Adresse
//   3. Versand      — SMTP, NUR wenn der Empfänger eine Sammel-Adresse
//                     nutzt (Kontist/Accountable/sevDesk). Dort braucht
//                     der Anbieter ein explizites Absender-Postfach zur
//                     Zuordnung. Bei direkt-an-Steuerkanzlei oder Custom
//                     entfällt der Schritt — gesendet wird vom Postfach
//                     aus Schritt 1.
//   4. Bestätigung
const FULL_STEP_KEYS: StepKey[] = ["postfach", "buchhaltung", "versand", "bestaetigung"];

function getActiveStepKeys(recipientKey: string): StepKey[] {
  return isSharedInboxRecipient(recipientKey)
    ? FULL_STEP_KEYS
    : FULL_STEP_KEYS.filter((k) => k !== "versand");
}

// ─── sessionStorage helpers ───────────────────────────────────────────────────

// User-scoped Key. Vorher war "onboarding-wizard" global gespeichert: nach
// Konto-Löschung und Neu-Anmeldung mit gleicher E-Mail hat der Wizard die
// Eingaben des Vorgängers wieder eingeblendet (selber Browser-Tab, neue
// userId in der DB, aber gleicher Storage-Key). Jetzt scoped auf userId
// — der gelöschte User existiert nicht mehr, neue userId → neuer Slot,
// kein Restore von "Geistern". Legacy-Key wird beim Mount aufgeräumt.
const LEGACY_STORAGE_KEY = "onboarding-wizard";
function storageKeyFor(userId: string): string {
  return `onboarding-wizard:${userId}`;
}

type PersistedState = {
  step: number;
  data: Omit<WizardData, "imapPassword" | "smtpPassword" | "senderPassword">;
};

function loadFromStorage(userId: string): PersistedState | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = sessionStorage.getItem(storageKeyFor(userId));
    return raw ? (JSON.parse(raw) as PersistedState) : null;
  } catch {
    return null;
  }
}

function saveToStorage(userId: string, step: number, data: WizardData): void {
  if (typeof window === "undefined") return;
  try {
    const { imapPassword: _ip, smtpPassword: _sp, senderPassword: _snp, ...rest } = data;
    sessionStorage.setItem(
      storageKeyFor(userId),
      // Voller Step persistieren — der Component clampt beim Render auf
      // stepKeys.length - 1, falls die activeKeys-Liste später kürzer ist.
      // Passwörter bewusst nicht persistieren (siehe destructuring oben).
      JSON.stringify({ step, data: rest } satisfies PersistedState),
    );
  } catch {}
}

function clearStorage(userId: string): void {
  if (typeof window === "undefined") return;
  try { sessionStorage.removeItem(storageKeyFor(userId)); } catch {}
}

/** Räumt den alten globalen Key aus früheren Wizard-Versionen weg. */
function clearLegacyStorage(): void {
  if (typeof window === "undefined") return;
  try { sessionStorage.removeItem(LEGACY_STORAGE_KEY); } catch {}
}

// ─── Defaults ────────────────────────────────────────────────────────────────

const DEFAULT_DATA: WizardData = {
  imapEmail: "", imapPassword: "",
  imapHost: "", imapPort: 993, imapSecure: true,
  // SMTP-Fallback für unbekannte Domains: 587 + STARTTLS ist heute der
  // gängige Standard; 465 (implizites SSL) führt bei vielen Mailservern
  // (z. B. IONOS-Custom-Domains) zu Connect-Errors. Provider-Presets
  // überschreiben das pro Anbieter (siehe mail-providers.ts).
  smtpHost: "", smtpPort: 587, smtpSecure: false,
  smtpEmail: "", smtpPassword: "",
  recipientName: "", recipientEmail: "",
  recipientKey: "custom",
  recipientSlot: "kontist",
  senderEmail: "", senderPassword: "",
  senderSmtpHost: "", senderSmtpPort: 587, senderSmtpSecure: false,
};

const IMAP_SMTP_DEFAULTS = {
  imapEmail: "", imapPassword: "",
  imapHost: "", imapPort: 993, imapSecure: true,
  smtpHost: "", smtpPort: 587, smtpSecure: false,
  smtpEmail: "", smtpPassword: "",
};

// Effective SMTP/send settings = der Stand aus Step 3 ("Versand").
// Step 3 ist immer da und wird beim Übergang Step 1→2 mit den IMAP-Werten
// vorbelegt, sodass für Standard-Postfächer kein erneutes Tippen nötig ist.
// Bei Shared-Inbox-Recipients überschreibt der User dort die Sende-Adresse.
function effectiveSmtp(d: WizardData): {
  host: string; port: number; secure: boolean; user: string; pass: string;
} {
  return {
    host: d.senderSmtpHost,
    port: d.senderSmtpPort,
    secure: d.senderSmtpSecure,
    user: d.senderEmail,
    pass: d.senderPassword,
  };
}

// ─── Component ────────────────────────────────────────────────────────────────

const initialActionState: OnboardingState = { status: "idle", message: "" };

export function OnboardingWizard({
  userId,
  editMode = false,
}: {
  userId: string;
  editMode?: boolean;
}) {
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
    // Legacy-Key (vor User-Scoping) wegräumen — schadet niemandem und
    // verhindert dass ein altes "Geist"-Restore die neue, scoped-State
    // überschreibt.
    clearLegacyStorage();
    const saved = loadFromStorage(userId);
    if (saved) {
      // Passwörter werden bewusst nicht persistiert — Restore stellt nur
      // Email + Server-Daten wieder her. MailboxConnectContent füllt sich
      // beim Mount aus `initialEmail` + `initialServers`.
      const restored = {
        ...DEFAULT_DATA,
        ...saved.data,
        imapPassword: "",
        smtpPassword: "",
        senderPassword: "",
      };
      /* eslint-disable react-hooks/set-state-in-effect */
      setData(restored);
      setStep(saved.step);
      /* eslint-enable react-hooks/set-state-in-effect */
    }
    setHydrated(true);
    // userId ist eine stabile Prop für die Lebensdauer dieser Mount-Phase
    // — wir wollen ausdrücklich KEIN Re-Hydration bei (theoretischem)
    // userId-Wechsel, deshalb leeres Dependency-Array statt [userId].
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const [actionState, formAction, isPending] = useActionState(
    completeOnboardingAction,
    initialActionState,
  );
  const [validationError, setValidationError] = useState<string | null>(null);

  type TestPhase = "idle" | "testing" | "success" | "error";
  const [testPhase, setTestPhase] = useState<TestPhase>("idle");
  const [testErrors, setTestErrors] = useState<{ imap?: string; smtp?: string }>({});
  // Which protocols the current step's test actually cares about: Postfach
  // (receiving) checks IMAP + its SMTP; Versand (send-only) checks SMTP only.
  const [testScope, setTestScope] = useState<{ imap: boolean; smtp: boolean }>({ imap: true, smtp: true });

  useEffect(() => {
    if (!hydrated) return;
    saveToStorage(userId, step, data);
  }, [hydrated, step, data, userId]);

  const set = (key: keyof WizardData) =>
    (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) =>
      setData((d) => ({ ...d, [key]: e.target.value }));

  const selectedRecipient =
    data.recipientKey === "custom"
      ? null
      : RECIPIENTS.find((r) => r.key === data.recipientKey) ?? null;
  const selectedRecipientHint = selectedRecipient?.hint ?? null;

  const submitSmtp = effectiveSmtp(data);

  // Step-Liste dynamisch (3 oder 4) basierend auf Recipient. `step` ist
  // Index in stepKeys. Wenn der User mitten im Flow den Recipient von
  // shared zu personal wechselt, schrumpft stepKeys um 1 — clampedStep
  // unten haelt den Index in den gueltigen Bereich.
  const stepKeys = getActiveStepKeys(data.recipientKey);
  const clampedStep = Math.min(step, stepKeys.length - 1);
  const currentKey = stepKeys[clampedStep];
  const isLastStep = clampedStep === stepKeys.length - 1;
  const displayCurrentIdx = clampedStep;

  const advance = () => setStep(() => Math.min(stepKeys.length - 1, clampedStep + 1));

  // Connection test against the receiving IMAP + a given SMTP account.
  // On success, advances to the next step after a short confirmation.
  const runTestAndAdvance = async (
    smtp: { host: string; port: number; secure: boolean; user: string; pass: string },
    scope: { imap: boolean; smtp: boolean },
  ) => {
    setTestScope(scope);
    setTestPhase("testing");
    setTestErrors({});

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

    const imapOk = scope.imap ? result.imap.ok : true;
    const smtpOk = scope.smtp ? result.smtp.ok : true;

    if (imapOk && smtpOk) {
      setTestPhase("success");
      setTimeout(() => {
        setTestPhase("idle");
        advance();
      }, 900);
    } else {
      setTestPhase("error");
      setTestErrors({
        imap: scope.imap && !result.imap.ok ? result.imap.error : undefined,
        smtp: scope.smtp && !result.smtp.ok ? result.smtp.error : undefined,
      });
    }
  };

  const next = async () => {
    setValidationError(null);

    if (currentKey === "postfach") {
      if (!data.imapEmail)    { setValidationError("Bitte E-Mail-Adresse eingeben."); return; }
      if (!data.imapPassword) { setValidationError("Bitte Passwort eingeben."); return; }
      if (!data.imapHost)     { setValidationError("Server-Details fehlen — bitte Provider auswählen oder manuell eingeben."); return; }
      // Step 1 testet sowohl IMAP als auch SMTP gegen die eingegebenen
      // Credentials (Standard-Annahme: gleicher Account fuer Empfang +
      // Versand). Bei Shared-Inbox-Recipients (Kontist/Accountable/...)
      // kann der SMTP-Versand spaeter in Step 3 mit anderen Credentials
      // ueberschrieben werden (Step 3 erscheint nur dort, siehe O1).
      // Senderdefaults fuer Step 3 schon hier vorbelegen.
      setData((prev) => ({
        ...prev,
        senderEmail:      prev.senderEmail      || prev.imapEmail,
        senderPassword:   prev.senderPassword   || prev.imapPassword,
        senderSmtpHost:   prev.senderSmtpHost   || prev.smtpHost || prev.imapHost,
        senderSmtpPort:   prev.senderSmtpPort   || prev.smtpPort,
        senderSmtpSecure: prev.senderSmtpSecure ?? prev.smtpSecure,
      }));
      await runTestAndAdvance(
        {
          host: data.smtpHost || data.imapHost,
          port: data.smtpPort,
          secure: data.smtpSecure,
          user: data.imapEmail,
          pass: data.imapPassword,
        },
        { imap: true, smtp: true },
      );
      return;
    }

    if (currentKey === "buchhaltung") {
      if (!data.recipientEmail) {
        setValidationError("Bitte Empfänger-Adresse eingeben.");
        return;
      }
      advance();
      return;
    }

    if (currentKey === "versand") {
      if (!data.senderEmail)    { setValidationError("Bitte Sende-Adresse eingeben."); return; }
      if (!data.senderPassword) { setValidationError("Bitte Passwort für den Versand eingeben."); return; }
      if (!data.senderSmtpHost) { setValidationError("Sende-Server fehlt — bitte SMTP-Host eintragen."); return; }
      // Versand = send-only mailbox: only SMTP is relevant.
      await runTestAndAdvance(
        {
          host: data.senderSmtpHost,
          port: data.senderSmtpPort,
          secure: data.senderSmtpSecure,
          user: data.senderEmail,
          pass: data.senderPassword,
        },
        { imap: false, smtp: true },
      );
      return;
    }
  };
  const back = () => { setValidationError(null); setTestPhase("idle"); setTestErrors({}); setStep(() => Math.max(0, clampedStep - 1)); };

  // Auf Step 0 ersetzt der Button "Abbrechen" die Zurück-Aktion: persistierten
  // Wizard-State löschen, Supabase-Session beenden, zurück zum Login. Das
  // angelegte (leere) User-Konto bleibt in Auth — ohne mail_account ist es
  // wirkungslos und wird beim nächsten Setup-Versuch übernommen.
  const handleCancel = async () => {
    clearStorage(userId);
    setValidationError(null);
    setTestPhase("idle");
    setTestErrors({});
    await logout();
  };

  // Stable so MailboxConnectContent's data-sync effect doesn't re-fire every render.
  const handleMailboxData = useCallback((d: MailboxData | null) => {
    setTestPhase((p) => (p === "error" ? "idle" : p));
    setTestErrors((e) => (Object.keys(e).length ? {} : e));
    if (d) {
      setData((prev) => ({
        ...prev,
        imapEmail: d.email,
        // Wenn die Mailbox-Komponente nach Back-Navigation neu mountet, ist
        // ihr Passwort-Feld leer — wir wollen aber das ursprünglich getippte
        // Passwort nicht überschreiben.
        imapPassword: d.password || prev.imapPassword,
        imapHost: d.imapHost,
        imapPort: d.imapPort,
        imapSecure: d.imapSecure,
        smtpHost: d.smtpHost,
        smtpPort: d.smtpPort,
        smtpSecure: d.smtpSecure,
        smtpEmail: d.smtpEmail,
        smtpPassword: d.smtpPassword || prev.smtpPassword,
      }));
    } else {
      setData((prev) => ({ ...prev, ...IMAP_SMTP_DEFAULTS }));
    }
  }, []);

  // Send mailbox uses the same MailboxConnectContent as the receiving one;
  // we only consume its SMTP side (the send account isn't read via IMAP).
  const handleSenderMailboxData = useCallback((d: MailboxData | null) => {
    setTestPhase((p) => (p === "error" ? "idle" : p));
    setTestErrors((e) => (Object.keys(e).length ? {} : e));
    if (d) {
      setData((prev) => ({
        ...prev,
        senderEmail: d.smtpEmail,
        // Passwort beim Re-Mount nicht durch leeren Wert überschreiben.
        senderPassword: d.smtpPassword || prev.senderPassword,
        senderSmtpHost: d.smtpHost,
        senderSmtpPort: d.smtpPort,
        senderSmtpSecure: d.smtpSecure,
      }));
    } else {
      setData((prev) => ({
        ...prev,
        senderEmail: "",
        senderPassword: "",
        senderSmtpHost: "",
        senderSmtpPort: 587,
        senderSmtpSecure: false,
      }));
    }
  }, []);

  // Nach erfolgreichem Setup: kurz sichtbarer Erfolgs-State, dann zum
  // Erstabruf-Screen. Im Render-Body zu pushen war ein Side-Effect-Bug:
  // konnte zu doppelten Navigationen führen und der User sah keinen
  // klaren Übergang ("kein Erfolgserlebnis"-Report). Der Erfolgs-Zustand
  // wird direkt aus `actionState.status` abgeleitet — kein zusätzlicher
  // State nötig.
  const setupSucceeded = actionState.status === "success";
  useEffect(() => {
    if (!setupSucceeded) return;
    clearStorage(userId);
    const t = setTimeout(() => router.push("/onboarding/erstabruf"), 900);
    return () => clearTimeout(t);
  }, [setupSucceeded, router, userId]);

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

      {/* ── Edit-Mode-Banner ──────────────────────────────────────────────── */}
      {editMode && (
        <div className="mx-auto w-full max-w-2xl px-4 sm:px-6 mt-4">
          <div className="rounded-md border border-brand/30 bg-brand-soft/40 px-4 py-3 text-xs text-ink">
            Du bearbeitest dein bestehendes Setup. Passwörter musst du aus
            Sicherheitsgründen erneut eingeben — bestehende Empfänger und
            Server-Daten bleiben unverändert, bis du sie überschreibst.
          </div>
        </div>
      )}

      {/* ── Progress ──────────────────────────────────────────────────────── */}
      <div className="mx-auto w-full max-w-2xl px-4 sm:px-6 mt-6 sm:mt-8 mb-2">
        <div className="flex items-center justify-between gap-2">
          {stepKeys.map((key, i) => {
            const isPast = i < displayCurrentIdx;
            const isCurrent = i === displayCurrentIdx;
            return (
              <Fragment key={key}>
                <div className="flex min-w-0 items-center gap-2">
                  <div
                    className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-xs font-semibold transition-colors ${
                      isPast
                        ? "bg-ok text-white"
                        : isCurrent
                          ? "bg-brand text-paper"
                          : "border border-line bg-white text-muted"
                    }`}
                  >
                    {isPast ? <Check size={12} /> : i + 1}
                  </div>
                  <span
                    className={`hidden xs:block truncate text-xs font-medium ${
                      isCurrent ? "text-ink" : "text-muted"
                    }`}
                  >
                    {STEP_LABELS[key]}
                  </span>
                </div>
                {i < stepKeys.length - 1 && (
                  <div className={`h-px flex-1 ${i < displayCurrentIdx ? "bg-ok" : "bg-line"}`} />
                )}
              </Fragment>
            );
          })}
        </div>
      </div>

      {/* ── Step content ──────────────────────────────────────────────────── */}
      <main className="mx-auto w-full max-w-2xl flex-1 px-4 sm:px-6 py-6 sm:py-8 md:py-12">

        {/* Postfach — IMAP-only (Empfangsserver) */}
        {currentKey === "postfach" && (
          <div>
            <h1 className="text-2xl font-semibold tracking-tight text-ink md:text-3xl">
              Aus welchem Postfach holen wir Rechnungen?
            </h1>
            <p className="mt-2 text-sm text-muted">
              Trage die E-Mail-Adresse und das Passwort des Postfachs ein, das Infetch scannen soll.
            </p>
            <div className="mt-6 rounded-md border border-line bg-paper p-5">
              <MailboxConnectContent
                mode="onboarding"
                purpose="imap-only"
                initialEmail={data.imapEmail || undefined}
                initialServers={{
                  imapHost: data.imapHost || undefined,
                  imapPort: data.imapPort,
                  imapSecure: data.imapSecure,
                  smtpHost: data.smtpHost || undefined,
                  smtpPort: data.smtpPort,
                  smtpSecure: data.smtpSecure,
                }}
                onDataChange={handleMailboxData}
              />
            </div>
          </div>
        )}

        {/* Versand — SMTP, immer da, vorausgefüllt aus Step 1 */}
        {currentKey === "versand" && (
          <div>
            <h1 className="text-2xl font-semibold tracking-tight text-ink md:text-3xl">
              Von welchem Konto soll Infetch versenden?
            </h1>
            <p className="mt-2 text-sm text-muted">
              {isSharedInboxRecipient(data.recipientKey) && selectedRecipient?.email ? (
                <>
                  <span className="font-medium text-ink">{selectedRecipient.label}</span>{" "}
                  nutzt eine Sammel-Adresse (<span className="font-mono">{selectedRecipient.email}</span>)
                  und erkennt dich an deiner <span className="font-medium text-ink">Absender-Adresse</span>.
                  Trage die dort hinterlegte E-Mail ein — von diesem Konto senden wir die Rechnungen.
                </>
              ) : (
                <>
                  Standardmäßig wird vom Postfach aus Schritt 1 gesendet. Du kannst hier ein anderes SMTP-Konto eintragen, falls Versand und Empfang getrennt sind.
                </>
              )}
            </p>

            <div className="mt-6 rounded-md border border-line bg-paper p-5">
              <MailboxConnectContent
                mode="onboarding"
                purpose="smtp-only"
                initialEmail={data.senderEmail || undefined}
                initialServers={{
                  smtpHost: data.senderSmtpHost || undefined,
                  smtpPort: data.senderSmtpPort,
                  smtpSecure: data.senderSmtpSecure,
                }}
                onDataChange={handleSenderMailboxData}
              />
            </div>
          </div>
        )}

        {/* Buchhaltung — recipient */}
        {currentKey === "buchhaltung" && (
          <div>
            <h1 className="text-2xl font-semibold tracking-tight text-ink md:text-3xl">
              An wen schicken wir deine Rechnungen?
            </h1>
            <p className="mt-2 text-sm text-muted">
              Deine Steuerkanzlei, ein Buchhaltungs-Tool wie Kontist oder
              Lexoffice — oder eine eigene Adresse. Spaeter ergaenzbar.
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
                    aria-describedby={selectedRecipientHint ? "recipient-email-hint" : undefined}
                    className="h-9 w-full rounded border border-line bg-surface px-3 font-mono text-sm outline-none focus:border-brand focus:ring-2 focus:ring-brand/20"
                  />
                  {selectedRecipientHint && (
                    <p id="recipient-email-hint" role="note" className="mt-1.5 text-xs text-muted">
                      {selectedRecipientHint}
                    </p>
                  )}
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Bestätigung */}
        {currentKey === "bestaetigung" && (
          <div>
            <h1 className="text-2xl font-semibold tracking-tight text-ink md:text-3xl">
              Alles bereit — kurze Zusammenfassung.
            </h1>

            <dl className="mt-6 divide-y divide-line rounded-md border border-line bg-paper">
              <div className="flex items-baseline gap-3 px-4 py-3">
                <dt className="w-28 shrink-0 text-xs text-muted">Posteingang</dt>
                <dd className="text-sm text-ink font-mono">{data.imapEmail || "IMAP-Zugang"}</dd>
              </div>
              {isSharedInboxRecipient(data.recipientKey) && data.senderEmail && (
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
                <div className="font-medium">Jederzeit kündbar.</div>
                <div className="mt-0.5 text-muted">
                  Du kannst Infetch in den Einstellungen pausieren, Empfänger anpassen oder dein Konto schließen.
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
            <span>
              Prüfe {testScope.imap && testScope.smtp ? "IMAP und SMTP" : testScope.smtp ? "SMTP" : "IMAP"}…
            </span>
          </div>
        )}
        {testPhase === "success" && (
          <div className="mt-4 flex items-center gap-3 text-sm text-ok">
            {testScope.imap && (
              <span className="flex items-center gap-1"><Check size={14} aria-hidden /> IMAP verbunden</span>
            )}
            {testScope.smtp && (
              <span className="flex items-center gap-1"><Check size={14} aria-hidden /> SMTP verbunden</span>
            )}
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
          {clampedStep === 0 ? (
            <Button
              variant="ghost"
              onClick={handleCancel}
              disabled={testPhase === "testing"}
            >
              Abbrechen
            </Button>
          ) : (
            <Button
              variant="ghost"
              onClick={back}
              disabled={testPhase === "testing"}
              className="gap-1.5"
            >
              <ArrowLeft size={16} aria-hidden /> zurück
            </Button>
          )}

          {!isLastStep ? (
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
              <Button type="submit" disabled={isPending || setupSucceeded} className="gap-1.5">
                {setupSucceeded ? (
                  <><Check size={16} aria-hidden /> Postfach verbunden — starte Scan…</>
                ) : isPending ? (
                  <><Loader2 size={16} className="animate-spin" aria-hidden /> Postfach wird verbunden…</>
                ) : (
                  <><span>Setup abschließen</span><ArrowRight size={16} aria-hidden /></>
                )}
              </Button>
            </form>
          )}
        </div>
      </main>
    </div>
  );
}
