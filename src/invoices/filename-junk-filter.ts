// Filename-basierte Junk-Erkennung — spart Mistral-Calls für PDFs deren
// Dateinamen schon eindeutig auf Nicht-Rechnungen hindeuten (AGB,
// Widerrufsbelehrung, Boarding-Pass, Tickets, Datenschutz, Verträge, etc.).
//
// Konservativ gehalten: nur eindeutige Patterns, keine generischen Wörter.
// Bei Match → Beleg landet direkt mit Status 'ignored' ohne AI-Call.

const JUNK_PATTERNS: RegExp[] = [
  /widerrufsbelehrung/i,
  /widerrufsrecht/i,
  /widerruf[._-]?form/i,
  /\bagb\b/i,
  /allgemeine[._-]?geschaeftsbedingungen/i,
  /terms[._-]?(of[._-]?service|conditions)/i,
  /\bt[._-]?and[._-]?c\b/i,
  /\bboarding[._-]?pass\b/i,
  /flugticket/i,
  /\bticket\b/i,
  /datenschutz/i,
  /privacy[._-]?policy/i,
  /\bav[._-]?vertrag/i,
  /\bavv\b/i,
  /\bdpa\b/i,
  /data[._-]?processing[._-]?agreement/i,
  /preisliste/i,
  /price[._-]?list/i,
];

export type FilenameJunkResult = {
  isJunk: boolean;
  matchedPattern: string | null;
};

export function classifyFilenameAsJunk(filename: string | null | undefined): FilenameJunkResult {
  if (!filename) return { isJunk: false, matchedPattern: null };
  const base = filename.split("/").pop() ?? filename;
  // Normalize _ and - to . so \b word-boundary checks work on separator chars:
  // "AGB_Shop.pdf" → "AGB.Shop.pdf"; \bagb\b matches because . is \W.
  const normalized = base.replace(/[_-]/g, ".");
  for (const pattern of JUNK_PATTERNS) {
    if (pattern.test(base) || pattern.test(normalized)) {
      return { isJunk: true, matchedPattern: pattern.source };
    }
  }
  return { isJunk: false, matchedPattern: null };
}
