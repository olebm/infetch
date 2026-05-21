import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

/**
 * Einfache E-Mail-Validierung: prüft ob Format plausibel ist
 * (lokaler Teil @ Domain.TLD). Blockt "buchhalter@" ohne TLD und
 * "buchhalter@example" ohne Punkt nach @.
 *
 * Absichtlich permissiv (kein RFC 5321-Vollparser) — verhindert die
 * häufigsten Tippfehler ohne valide Sonderadressen abzulehnen.
 */
export function isValidEmail(email: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim());
}
