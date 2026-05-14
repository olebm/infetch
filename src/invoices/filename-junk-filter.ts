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
  for (const pattern of JUNK_PATTERNS) {
    if (pattern.test(base)) {
      return { isJunk: true, matchedPattern: pattern.source };
    }
  }
  return { isJunk: false, matchedPattern: null };
}
