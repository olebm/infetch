/**
 * Canonical list of invoice-recipient presets (accounting destinations) plus
 * subject-template helpers. Single source of truth shared by the onboarding
 * wizard and the post-onboarding recipient modal.
 */

export type TargetSlot = "kontist" | "accountable";

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
    hint: "Deine persönliche Adresse (Format: eingang.Name@belege.buchhaltungsbutler.de) findest du in deinen Kontoeinstellungen.",
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
  },
];

// ── Subject template ──────────────────────────────────────────────────────────

export type SubjectVars = {
  vendor?: string | null;
  date?: string | null;
  amount?: string | null;
};

export const SUBJECT_VARIABLES: { token: string; label: string; sample: string }[] = [
  { token: "{{vendor}}", label: "Absender", sample: "Telekom" },
  { token: "{{date}}", label: "Rechnungsdatum", sample: "2026-05-12" },
  { token: "{{amount}}", label: "Betrag", sample: "149,00 EUR" },
];

export const DEFAULT_SUBJECT_TEMPLATE = "Rechnung · {{vendor}} · {{date}} · {{amount}}";

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
