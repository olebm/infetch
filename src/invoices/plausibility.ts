// Plausibilitäts-Check für extrahierte Rechnungsfelder.
//
// Entscheidet, ob eine Rechnung zuverlässig genug erfasst wurde, um sie OHNE
// manuelle Prüfung freizugeben (status='ready' → Auto-Export). Bewusst
// signal-basiert statt einer einzelnen harten Betragsgrenze: eine fehlende
// Währung, ein in der Zukunft liegendes Rechnungsdatum oder ein absurd
// großer/negativer Betrag deuten auf eine fehlerhafte lokale Extraktion hin
// (z. B. ein gieriger Regex, der "350.167.000,00 €" aus Vertragsnummer +
// Betrag zusammenklebt). Solche Rechnungen gehören in die manuelle Prüfung,
// nicht ungeprüft an die Buchhaltung.
//
// Die Obergrenze (1 Mio €) ist ein Not-Netz für Extraktions-Ausreißer, KEINE
// fachliche Aussage über erlaubte Rechnungsbeträge — Beträge nahe/über der
// Grenze landen lediglich im Review statt im Auto-Export.

export const MAX_PLAUSIBLE_AMOUNT_GROSS = 1_000_000;

export type PlausibilityInput = {
  amountGross: number | null;
  currency: string | null;
  invoiceDate: string | null; // ISO yyyy-mm-dd
};

export type ImplausibilityReason =
  | "currency_missing"
  | "amount_missing"
  | "amount_non_positive"
  | "amount_too_large"
  | "date_missing"
  | "date_in_future";

/**
 * Liefert den ERSTEN gefundenen Grund, warum die Extraktion unplausibel ist —
 * oder null, wenn alle Plausibilitäts-Signale ok sind. Der Grund eignet sich
 * für Audit-/Sync-Events ("warum landete diese Rechnung im Review?").
 */
export function describeImplausibility(
  input: PlausibilityInput,
  now: Date = new Date(),
): ImplausibilityReason | null {
  const { amountGross, currency, invoiceDate } = input;
  if (!currency) return "currency_missing";
  if (amountGross == null) return "amount_missing";
  if (amountGross <= 0) return "amount_non_positive";
  if (amountGross > MAX_PLAUSIBLE_AMOUNT_GROSS) return "amount_too_large";
  if (!invoiceDate) return "date_missing";
  if (isFutureDate(invoiceDate, now)) return "date_in_future";
  return null;
}

export function isExtractionPlausible(input: PlausibilityInput, now: Date = new Date()): boolean {
  return describeImplausibility(input, now) === null;
}

/** Rechnungsdatum strikt nach heute (Tagesebene, UTC) = unplausibel. */
function isFutureDate(iso: string, now: Date): boolean {
  const parsed = Date.parse(`${iso}T00:00:00.000Z`);
  if (Number.isNaN(parsed)) return false; // unparsebar → nicht als Zukunft werten
  const todayUtc = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  return parsed > todayUtc;
}
