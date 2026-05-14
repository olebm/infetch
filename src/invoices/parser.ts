export type ParsedInvoiceFields = {
  invoiceDate: string | null;
  invoiceNumber: string | null;
  amountGross: number | null;
  currency: string | null;
};

const isoDatePattern = /\b(20\d{2})[-/.](0?[1-9]|1[0-2])[-/.](0?[1-9]|[12]\d|3[01])(?=\D|$)/;
const germanDatePattern = /\b(0?[1-9]|[12]\d|3[01])[.](0?[1-9]|1[0-2])[.](20\d{2})\b/;
const invoiceNumberPattern =
  /\b(?:rechnungsnummer|rechnung\s*nr\.?|invoice\s*number|invoice\s*no\.?)\s*[:#-]\s*([A-Z0-9][A-Z0-9._/-]{2,})/i;
const amountPattern = /\b(?:total|summe|gesamt|amount|betrag)\s*[:#-]?\s*([0-9]{1,6}(?:[.,][0-9]{2}))\s*(EUR|€|USD|\$)?/i;

export function parseInvoiceFields(text: string, filename = ""): ParsedInvoiceFields {
  const input = `${filename}\n${text}`;
  const iso = input.match(isoDatePattern);
  const german = input.match(germanDatePattern);
  const invoiceNumber = input.match(invoiceNumberPattern)?.[1] || null;
  const amount = input.match(amountPattern);

  return {
    invoiceDate: iso ? normalizeIsoDate(iso) : german ? normalizeGermanDate(german) : null,
    invoiceNumber,
    amountGross: amount?.[1] ? parseAmount(amount[1]) : null,
    currency: normalizeCurrency(amount?.[2] || null),
  };
}

function normalizeIsoDate(match: RegExpMatchArray) {
  const [, year, month, day] = match;
  return `${year}-${month.padStart(2, "0")}-${day.padStart(2, "0")}`;
}

function normalizeGermanDate(match: RegExpMatchArray) {
  const [, day, month, year] = match;
  return `${year}-${month.padStart(2, "0")}-${day.padStart(2, "0")}`;
}

function parseAmount(raw: string) {
  const normalized = raw.includes(",") ? raw.replace(/\./g, "").replace(",", ".") : raw;
  return Number.parseFloat(normalized);
}

function normalizeCurrency(raw: string | null) {
  if (!raw) return null;
  if (raw === "€") return "EUR";
  if (raw === "$") return "USD";
  return raw.toUpperCase();
}
