export type ParsedInvoiceFields = {
  invoiceDate: string | null;
  invoiceNumber: string | null;
  amountGross: number | null;
  currency: string | null;
};

const isoDatePattern = /\b(20\d{2})[-/.](0?[1-9]|1[0-2])[-/.](0?[1-9]|[12]\d|3[01])(?=\D|$)/;
const germanDatePattern = /\b(0?[1-9]|[12]\d|3[01])[.](0?[1-9]|1[0-2])[.](20\d{2})\b/;

// Englische Monatsnamen-Daten auf US/intl. SaaS-Belegen (Stripe/Paddle):
// "July 7, 2026" · "Jul 7 2026" · "7 July 2026" · "Sept 05th, 2026".
// Rein numerische US-Slashes (07/07/2026) bleiben bewusst außen vor —
// MM/DD vs. DD/MM ist mehrdeutig und Sache der KI-Extraktion.
const EN_MONTHS: Record<string, number> = {
  jan: 1,
  feb: 2,
  mar: 3,
  apr: 4,
  may: 5,
  jun: 6,
  jul: 7,
  aug: 8,
  sep: 9,
  oct: 10,
  nov: 11,
  dec: 12,
};
const enMonth =
  "jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?";
const englishMonthFirstPattern = new RegExp(
  `\\b(${enMonth})\\.?\\s+(0?[1-9]|[12]\\d|3[01])(?:st|nd|rd|th)?,?\\s+(20\\d{2})\\b`,
  "i",
);
const englishDayFirstPattern = new RegExp(
  `\\b(0?[1-9]|[12]\\d|3[01])(?:st|nd|rd|th)?\\.?\\s+(${enMonth})\\.?,?\\s+(20\\d{2})\\b`,
  "i",
);
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
  const enMonthFirst = input.match(englishMonthFirstPattern);
  const enDayFirst = input.match(englishDayFirstPattern);
  const invoiceNumber = input.match(invoiceNumberPattern)?.[1] || null;
  const amount = input.match(amountPattern);

  const isoDate = iso ? normalizeIsoDate(iso) : null;
  const germanDate = german ? normalizeGermanDate(german) : null;
  // Englischer Fallback NUR wenn weder ISO noch DE griffen → bestehendes
  // Verhalten bleibt bitidentisch, es kommt reine Zusatz-Abdeckung dazu.
  const englishDate =
    (enMonthFirst
      ? normalizeEnglishDate(enMonthFirst[3], enMonthFirst[1], enMonthFirst[2])
      : null) ??
    (enDayFirst ? normalizeEnglishDate(enDayFirst[3], enDayFirst[2], enDayFirst[1]) : null);

  return {
    invoiceDate: isoDate ?? germanDate ?? englishDate ?? null,
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

// Kleine Toleranz gegen Zeitzonen-/Vordatierungs-Rauschen — alles darüber
// hinaus ist fast immer ein fehlinterpretiertes Fälligkeits-/Reminder-Datum.
const MAX_FUTURE_GRACE_DAYS = 2;

/** Ein Rechnungsdatum darf nicht (nennenswert) in der Zukunft liegen. */
function isNotFuture(iso: string, now: Date = new Date()): boolean {
  const parsed = Date.parse(`${iso}T00:00:00.000Z`);
  if (Number.isNaN(parsed)) return false;
  const cutoff =
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()) +
    MAX_FUTURE_GRACE_DAYS * 86_400_000;
  return parsed <= cutoff;
}

function normalizeIsoDate(match: RegExpMatchArray): string | null {
  const [, year, month, day] = match;
  const iso = buildValidDate(year, month, day);
  return iso && isNotFuture(iso) ? iso : null;
}

function normalizeGermanDate(match: RegExpMatchArray): string | null {
  const [, day, month, year] = match;
  const iso = buildValidDate(year, month, day);
  return iso && isNotFuture(iso) ? iso : null;
}

/** Englisches Monatsnamen-Datum → ISO. Nutzt dieselben Kalender-/Zukunfts-Guards. */
function normalizeEnglishDate(year: string, monthWord: string, day: string): string | null {
  const month = EN_MONTHS[monthWord.toLowerCase().slice(0, 3)];
  if (!month) return null;
  const iso = buildValidDate(year, String(month), day);
  return iso && isNotFuture(iso) ? iso : null;
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
  let integerGroupingPart: string; // Ganzzahlteil inkl. seiner Trenner — zur Gruppen-Prüfung

  if (lastSep === -1) {
    value = Number.parseFloat(s);
    integerGroupingPart = s;
  } else {
    const decimals = s.length - lastSep - 1;
    if (decimals === 1 || decimals === 2) {
      integerGroupingPart = s.slice(0, lastSep);
      const intPart = integerGroupingPart.replace(/[.,]/g, "");
      const fracPart = s.slice(lastSep + 1);
      value = Number.parseFloat(`${intPart || "0"}.${fracPart}`);
    } else {
      // Kein Dezimalteil → alle Trenner sind Tausendertrenner.
      integerGroupingPart = s;
      value = Number.parseFloat(s.replace(/[.,]/g, ""));
    }
  }

  if (!Number.isFinite(value)) return null;
  // Inkonsistente Tausender-Gruppierung (z. B. "12.34.567,89" aus verklebter
  // OCR) → unzuverlässig, lieber null und in Prüfung/KI statt Müll speichern.
  if (!hasConsistentThousandGrouping(integerGroupingPart)) return null;
  // Syntaktischer Wahnsinns-Cap: ≥ 1 Billion ist nie ein Rechnungsbetrag.
  // (Fachliche Plausibilität — z. B. > 1 Mio → Review — lebt in plausibility.ts.)
  if (Math.abs(value) >= 1e12) return null;
  return negative ? -value : value;
}

/**
 * Prüft, ob der Ganzzahlteil eines Betrags konsistent in Tausender-Gruppen
 * formatiert ist: führende Gruppe 1–3 Stellen, alle weiteren genau 3. Ohne
 * Trenner immer ok. Fängt verklebte/zerrissene Zahlen aus der PDF-Extraktion.
 */
function hasConsistentThousandGrouping(intPart: string): boolean {
  if (!/[.,]/.test(intPart)) return true;
  const groups = intPart.split(/[.,]/);
  if (groups[0].length < 1 || groups[0].length > 3) return false;
  return groups.slice(1).every((g) => g.length === 3);
}

function normalizeCurrency(raw: string | null) {
  if (!raw) return null;
  if (raw === "€") return "EUR";
  if (raw === "$") return "USD";
  return raw.toUpperCase();
}
