import { generate as generateTotpCode } from "otplib";

/**
 * Prüft, ob otplib aus dem (bereinigten) Base32-Secret tatsächlich einen TOTP-Code
 * erzeugen kann. otplib v13 verlangt ≥ 16 Byte (RFC 4226) — ein 16-stelliges
 * Base32-Secret (= 10 Byte) besteht zwar die Charset-Prüfung, scheitert aber bei
 * der Generierung mit SecretTooShortError. Wir validieren gegen otplibs echte
 * Regeln (ein Trial-Lauf) statt einer Zeichen-Heuristik — so kann der Connect-Pfad
 * kein Secret akzeptieren, das später im Lauf crasht (INFETCH-260).
 *
 * Bewusst KEINE Guardrail-Aufweichung: kürzere Secrets unter dem RFC-Minimum
 * werden abgelehnt, nicht durch Absenken der Sicherheitsschwelle erzwungen.
 */
export async function isUsableTotpSecret(secret: string): Promise<boolean> {
  if (!secret) return false;
  try {
    await generateTotpCode({ secret });
    return true;
  } catch {
    return false;
  }
}
