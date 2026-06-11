/**
 * Redaction der Eingabefelder vor Failure-Screenshots (INFETCH-266 / AC1).
 *
 * `maskSensitiveInputs` laeuft im Browser-Kontext (page.evaluate) und MUSS
 * self-contained sein (keine Imports/Closures), damit Playwright sie
 * serialisieren kann. Sie ueberschreibt die Werte aller Text-/Passwort-Eingaben
 * und Textareas mit einem Marker, BEVOR der Debug-Screenshot entsteht — so
 * exponiert kein Failure-Screenshot Credentials oder PII aus Eingabefeldern.
 * Checkbox/Radio/Button/File/Range/Color/Hidden bleiben unberuehrt (kein PII,
 * aber wertvoller Layout-Kontext fuer die Diagnose).
 *
 * Fail-closed: schlaegt das Masking fehl, wird KEIN Screenshot gespeichert
 * (Aufrufer in agent-connector laesst den catch greifen).
 */

/** Marker, mit dem maskierte Feldwerte ersetzt werden. */
export const SCREENSHOT_REDACTION_MARK = "[redacted]";

/**
 * Im Browser ausgefuehrt. Maskiert die Werte sensibler Eingabefelder und gibt
 * die Anzahl maskierter Felder zurueck. Der Marker-String ist hier dupliziert
 * (statt SCREENSHOT_REDACTION_MARK), weil die Funktion serialisiert in den
 * Browser geht und keine Modul-Konstanten referenzieren darf — der Test bindet
 * beide aneinander, sodass ein Drift rot wird.
 */
export function maskSensitiveInputs(): number {
  const MARK = "[redacted]";
  const SKIP = new Set([
    "checkbox",
    "radio",
    "button",
    "submit",
    "image",
    "hidden",
    "range",
    "color",
    "file",
  ]);
  const fields = Array.from(document.querySelectorAll("input, textarea"));
  let masked = 0;
  for (const el of fields) {
    if (el instanceof HTMLInputElement) {
      if (SKIP.has(el.type.toLowerCase())) continue;
      if ((el.value ?? "") === "") continue;
      el.value = MARK;
      el.setAttribute("value", MARK);
      masked++;
    } else if (el instanceof HTMLTextAreaElement) {
      if ((el.value ?? "") === "") continue;
      // textContent zuerst: entfernt den urspruenglichen Kind-Textknoten aus
      // dem DOM, damit der Klartext nirgends ueberlebt (auch nicht in einer
      // DOM-Serialisierung). value danach: gerenderter/Screenshot-Wert.
      el.textContent = MARK;
      el.value = MARK;
      masked++;
    }
  }
  return masked;
}
