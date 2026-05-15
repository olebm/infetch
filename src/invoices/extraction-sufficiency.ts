export function isLocalExtractionSufficient(
  vendorConfidence: number,
  parsed: { invoiceDate: string | null; amountGross: number | null },
  extraction: { error: string | null },
  overallConfidence: number,
): boolean {
  return (
    vendorConfidence >= 0.72 &&
    parsed.invoiceDate !== null &&
    parsed.amountGross !== null &&
    extraction.error === null &&
    overallConfidence >= 0.8
  );
}
