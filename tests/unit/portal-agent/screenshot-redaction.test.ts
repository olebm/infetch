// @vitest-environment happy-dom
import { beforeEach, describe, expect, it } from "vitest";
import {
  maskSensitiveInputs,
  SCREENSHOT_REDACTION_MARK,
} from "@/portals/agent/screenshot-redaction";

// INFETCH-266 / AC1: Failure-Screenshots duerfen keine Credentials/PII aus
// Eingabefeldern exponieren. maskSensitiveInputs laeuft im Browser-Kontext;
// hier gegen ein echtes DOM (happy-dom) verifiziert.

describe("maskSensitiveInputs (Failure-Screenshot-Redaction)", () => {
  beforeEach(() => {
    document.body.innerHTML = "";
  });

  it("maskiert Text-, E-Mail- und Passwort-Werte sowie Textareas", () => {
    document.body.innerHTML = `
      <input id="user" type="text" value="max@mustermann.de" />
      <input id="pw" type="password" value="hunter2-supersecret" />
      <input id="mail" type="email" value="rechnung@kunde.de" />
      <textarea id="note">Kundennummer 4711, 1.234,56 EUR</textarea>
    `;

    const masked = maskSensitiveInputs();

    expect(masked).toBe(4);
    const html = document.body.innerHTML;
    expect(html).not.toContain("max@mustermann.de");
    expect(html).not.toContain("hunter2-supersecret");
    expect(html).not.toContain("rechnung@kunde.de");
    expect(html).not.toContain("4711");
    // Marker im Code == exportierter Marker (Drift-Schutz)
    expect((document.getElementById("user") as HTMLInputElement).value).toBe(
      SCREENSHOT_REDACTION_MARK,
    );
    expect((document.getElementById("pw") as HTMLInputElement).value).toBe(
      SCREENSHOT_REDACTION_MARK,
    );
    expect((document.getElementById("note") as HTMLTextAreaElement).value).toBe(
      SCREENSHOT_REDACTION_MARK,
    );
  });

  it("laesst Checkbox/Radio/Submit/leere Felder unberuehrt", () => {
    document.body.innerHTML = `
      <input id="cb" type="checkbox" checked />
      <input id="rd" type="radio" value="optionA" checked />
      <input id="btn" type="submit" value="Anmelden" />
      <input id="empty" type="text" value="" />
    `;

    const masked = maskSensitiveInputs();

    expect(masked).toBe(0);
    expect((document.getElementById("cb") as HTMLInputElement).checked).toBe(true);
    expect((document.getElementById("btn") as HTMLInputElement).value).toBe("Anmelden");
  });
});
