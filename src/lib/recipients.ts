/**
 * Canonical list of invoice-recipient presets (accounting destinations) plus
 * subject-template helpers. Single source of truth shared by the onboarding
 * wizard and the post-onboarding recipient modal.
 */

export type TargetSlot = "kontist" | "accountable";

/** Ein konfiguriertes SMTP-Absende-Konto als Zuweisungs-Option für Empfänger. */
export type SmtpAccountOption = { slot: "primary" | "secondary"; fromAddress: string };

export interface Recipient {
  key: string;
  label: string;
  domain: string | null; // null = no reliable logo, show monogram chip
  email: string;
  slot: TargetSlot;
  hint?: string;
}

export const RECIPIENTS: Recipient[] = [
  {
    key: "accountable",
    label: "Accountable",
    domain: "accountable.eu",
    email: "expenses@accountable.eu",
    slot: "accountable",
    hint: "Für Ausgangsrechnungen (Einnahmen) stattdessen revenue@accountable.eu verwenden.",
  },
  {
    key: "billomat",
    label: "Billomat",
    domain: "billomat.com",
    email: "",
    slot: "kontist",
    hint: "Deine persönliche Adresse findest du in Billomat unter Einstellungen → Posteingang.",
  },
  {
    key: "buchhaltungsbutler",
    label: "BuchhaltungsButler",
    domain: null, // no logo on Brandfetch
    email: "",
    slot: "kontist",
    hint: "Deine persönliche Adresse (Format: eingang.Name@belege.buchhaltungsbutler.de) findest du in BuchhaltungsButler unter Konto → Einstellungen.",
  },
  {
    key: "datev",
    label: "DATEV",
    domain: "datev.de",
    email: "",
    slot: "kontist",
    hint: "Die Empfängeradresse wird von DATEV pro Belegtyp generiert. Du erhältst sie von deinem Steuerberater oder in DATEV Belege online.",
  },
  {
    key: "fastbill",
    label: "FastBill",
    domain: "fastbill.com",
    email: "",
    slot: "kontist",
    hint: "Deine persönliche Adresse findest du in FastBill unter Einstellungen → Übersicht. Ab Pro-Tarif verfügbar.",
  },
  {
    key: "kontist",
    label: "Kontist",
    domain: "kontist.dev",
    email: "belege@kontist.com",
    slot: "kontist",
    hint: "Gemeinsame Sammeladresse — Kontist ordnet Rechnungen über deine hinterlegte Absender-E-Mail zu, nicht über die Empfängeradresse.",
  },
  {
    key: "lexoffice",
    label: "Lexoffice",
    domain: "lexoffice.de",
    email: "",
    slot: "kontist",
    hint: "Deine persönliche Adresse (Format: name@inbox.lexware.email) findest du in Lexoffice unter Einstellungen → Belegempfang. Erfordert XL-Tarif.",
  },
  {
    key: "papierkram",
    label: "Papierkram",
    domain: null, // no logo on Brandfetch
    email: "",
    slot: "kontist",
    hint: 'Deine persönliche Adresse findest du in Papierkram unter Übersicht → Posteingang → "E-Mail empfangen".',
  },
  {
    key: "sevdesk",
    label: "sevDesk",
    domain: "sevdesk.de",
    email: "autobox@sevdesk.email",
    slot: "kontist",
    hint: "Gemeinsame Sammeladresse — sevDesk verknüpft Belege über die Absender-E-Mail deines Kontos.",
  },
];

/**
 * True if the recipient uses a single shared inbox for all customers
 * (e.g. belege@kontist.com). Such services identify the customer by the
 * SENDER address, so invoices must be sent from the address registered there
 * — which is why onboarding shows a dedicated mandatory "Versand" step for
 * these. Recipients with a per-user inbox (empty preset email) or a custom
 * recipient don't need it.
 */
export function isSharedInboxRecipient(recipientKey: string): boolean {
  const r = RECIPIENTS.find((x) => x.key === recipientKey);
  return !!r && r.email.trim() !== "";
}

// ── Subject template ──────────────────────────────────────────────────────────

export type SubjectVars = {
  vendor?: string | null;
  date?: string | null;
  amount?: string | null;
};

export const SUBJECT_VARIABLES: { token: string; label: string; sample: string }[] = [
  { token: "{{vendor}}", label: "Absender", sample: "Anbieter" },
  { token: "{{date}}", label: "Rechnungsdatum", sample: "2026-02-01" },
  { token: "{{amount}}", label: "Betrag", sample: "99,00 EUR" },
];

export const DEFAULT_SUBJECT_TEMPLATE = "Rechnung · {{vendor}} · {{date}} · {{amount}}";

/** Default schema for PDF attachment filenames on export/download. */
export const DEFAULT_PDF_FILENAME_TEMPLATE = "{{vendor}}_{{date}}_{{amount}}.pdf";

/**
 * Render a subject template. Missing values drop their token and any dangling
 * separators/empty brackets, so a template like
 * "[Rechnung] {{vendor}} · {{date}}" stays clean when date is absent.
 */
export function renderSubjectTemplate(template: string, v: SubjectVars): string {
  const map: Record<string, string> = {
    vendor: v.vendor ?? "",
    date: v.date ?? "",
    amount: v.amount ?? "",
  };
  const s = template
    .replace(/\{\{\s*(vendor|date|amount)\s*\}\}/g, (_, k: string) => map[k] ?? "")
    .replace(/\s*·\s*(?=·)/g, "") // collapse "· ·" left by an empty value
    .replace(/\(\s*\)|\[\s*\]/g, "") // drop empty () or [] brackets
    .replace(/^\s*[·\-–|]\s*/, "") // strip leading separator
    .replace(/\s*[·\-–|]\s*$/, "") // strip trailing separator
    .replace(/\s{2,}/g, " ")
    .trim();
  return s || "Rechnung";
}

/**
 * Render a PDF filename template.
 * Same tokens as renderSubjectTemplate but with filesystem-safe output:
 * – consecutive `_` from missing values are collapsed
 * – characters forbidden on Windows/macOS/Linux filesystems are stripped
 * – result always ends with `.pdf`
 * – falls back to "Rechnung.pdf" if everything resolves to empty
 */
export function renderPdfFilenameTemplate(template: string, v: SubjectVars): string {
  const map: Record<string, string> = {
    vendor: v.vendor ?? "",
    date: v.date ?? "",
    amount: v.amount ?? "",
  };

  // 1. Replace tokens.
  let s = template.replace(/\{\{\s*(vendor|date|amount)\s*\}\}/g, (_, k: string) => map[k] ?? "");

  // 2. Collapse consecutive underscores/dashes left by empty tokens.
  s = s.replace(/_{2,}/g, "_").replace(/-{2,}/g, "-");

  // 3. Strip characters illegal on Windows (and common platforms).
  s = s.replace(/[/\\:*?"<>|]/g, "");

  // 4. Separate out any .pdf extension so the cleanup doesn't destroy it.
  const hasPdfExt = /\.pdf$/i.test(s);
  const body = hasPdfExt ? s.slice(0, -4) : s;

  // 5. Strip leading/trailing separators from the body and normalise spaces.
  const clean = body
    .replace(/^[_\-.\s]+/, "")
    .replace(/[_\-.\s]+$/, "")
    .replace(/\s+/g, "_")
    .trim();

  return `${clean || "Rechnung"}.pdf`;
}
