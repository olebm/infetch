// Pragmatische E-Mail-Validierung: lokaler Teil @ Domain mit TLD (>= 2 Zeichen).
// Bewusst NICHT RFC-5322-vollstaendig — das fängt mehr exotische Edge-Cases
// als es real verhindert. Ziel: offensichtliche Tippfehler abfangen (fehlende
// TLD wie "buchhalter@", fehlendes @, Leerzeichen), bevor Rechnungen ins Leere
// versendet werden.
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

export function isValidEmail(value: string | null | undefined): boolean {
  if (!value) return false;
  return EMAIL_RE.test(value.trim());
}
