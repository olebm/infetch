import { isExtractionPlausible } from "@/invoices/plausibility";

export function isLocalExtractionSufficient(
  vendorConfidence: number,
  parsed: { invoiceDate: string | null; amountGross: number | null; currency: string | null },
  extraction: { error: string | null },
  overallConfidence: number,
): boolean {
  return (
    vendorConfidence >= 0.72 &&
    parsed.invoiceDate !== null &&
    parsed.amountGross !== null &&
    extraction.error === null &&
    overallConfidence >= 0.8 &&
    // Unplausibles (fehlende Währung / Zukunfts-Datum / absurder Betrag) NIE als
    // "lokal ausreichend" durchwinken — sonst überspringt der Import die KI und
    // speichert Müll. Lieber den KI-Call zahlen und korrigieren lassen.
    isExtractionPlausible({
      amountGross: parsed.amountGross,
      currency: parsed.currency,
      invoiceDate: parsed.invoiceDate,
    })
  );
}
