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
// Betrags-Token: optionales Vorzeichen / Klammer-Gutschrift, beliebig viele
// Tausendertrenner, optionale Dezimalstellen. Deckt 23,00 · 8.21 ·
// 1.234.567,89 · 1,234,567.89 · -12,50 · (99,00) · 0,00 ab.
const amountPattern =
  /\b(?:total|summe|gesamt|amount|betrag)\s*[:#=-]?\s*(\(?\s*-?\s*\d[\d.,]*\d\)?|\(?\s*-?\s*\d\)?)\s*(EUR|€|USD|\$)?/i;

export function parseInvoiceFields(text: string, filename = ""): ParsedInvoiceFields {
  const input = `${filename}\n${text}`;
  const iso = input.match(isoDatePattern);
  const german = input.match(germanDatePattern);
  const invoiceNumber = input.match(invoiceNumberPattern)?.[1] || null;
  const amount = input.match(amountPattern);

  const isoDate = iso ? normalizeIsoDate(iso) : null;
  const germanDate = german ? normalizeGermanDate(german) : null;

  return {
    invoiceDate: isoDate ?? germanDate ?? null,
    invoiceNumber,
    amountGross: amount?.[1] != null ? parseAmount(amount[1]) : null,
    currency: normalizeCurrency(amount?.[2] || null),
  };
}

/** Kalender-Plausibilität: weist z. B. 31.02.2026 zurück (→ null). */
function buildValidDate(year: string, month: string, day: string): string | null {
  const yy = Number(year);
  const mm = Number(month);
  const dd = Number(day);
  if (!Number.isInteger(yy) || !Number.isInteger(mm) || !Number.isInteger(dd)) return null;
  const dt = new Date(Date.UTC(yy, mm - 1, dd));
  if (dt.getUTCFullYear() !== yy || dt.getUTCMonth() !== mm - 1 || dt.getUTCDate() !== dd) {
    return null;
  }
  return `${yy}-${String(mm).padStart(2, "0")}-${String(dd).padStart(2, "0")}`;
}

function normalizeIsoDate(match: RegExpMatchArray): string | null {
  const [, year, month, day] = match;
  return buildValidDate(year, month, day);
}

function normalizeGermanDate(match: RegExpMatchArray): string | null {
  const [, day, month, year] = match;
  return buildValidDate(year, month, day);
}

/**
 * Robustes Betrags-Parsing. Erkennt das Dezimaltrennzeichen anhand der
 * letzten 1–2 Nachkommastellen; alle übrigen Punkte/Kommata sind
 * Tausendertrenner. Klammern oder führendes Minus → negativer Betrag
 * (Gutschrift). Gibt null zurück, wenn keine Zahl erkennbar ist.
 */
function parseAmount(raw: string): number | null {
  let s = raw.trim();
  let negative = false;

  if (/^\(.*\)$/.test(s)) {
    negative = true;
    s = s.slice(1, -1);
  }
  s = s.replace(/\s/g, "");
  if (s.startsWith("-")) {
    negative = true;
    s = s.slice(1);
  }

  if (!/^[0-9]?[0-9.,]*[0-9]$/.test(s)) return null;

  const lastSep = Math.max(s.lastIndexOf("."), s.lastIndexOf(","));
  let value: number;

  if (lastSep === -1) {
    value = Number.parseFloat(s);
  } else {
    const decimals = s.length - lastSep - 1;
    if (decimals === 1 || decimals === 2) {
      const intPart = s.slice(0, lastSep).replace(/[.,]/g, "");
      const fracPart = s.slice(lastSep + 1);
      value = Number.parseFloat(`${intPart || "0"}.${fracPart}`);
    } else {
      // Kein Dezimalteil → alle Trenner sind Tausendertrenner.
      value = Number.parseFloat(s.replace(/[.,]/g, ""));
    }
  }

  if (!Number.isFinite(value)) return null;
  return negative ? -value : value;
}

function normalizeCurrency(raw: string | null) {
  if (!raw) return null;
  if (raw === "€") return "EUR";
  if (raw === "$") return "USD";
  return raw.toUpperCase();
}
