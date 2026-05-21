import { describe, expect, it } from "vitest";
import { isValidEmail } from "@/lib/utils";

// INFETCH-200: Server-seitige E-Mail-Validierung für Empfänger-Adressen.
// Verhindert Rechnungen an unvollständige Adressen wie "buchhalter@".

describe("isValidEmail", () => {
  it("akzeptiert valide E-Mail-Adressen", () => {
    expect(isValidEmail("buchhalter@kanzlei.de")).toBe(true);
    expect(isValidEmail("steuer@mustermann.com")).toBe(true);
    expect(isValidEmail("info+rechnungen@buchhaltung.io")).toBe(true);
    expect(isValidEmail("a@b.co")).toBe(true);
  });

  it("lehnt E-Mail ohne TLD ab (buchhalter@example → false)", () => {
    expect(isValidEmail("buchhalter@example")).toBe(false);
  });

  it("lehnt E-Mail ohne Domain ab (buchhalter@ → false)", () => {
    expect(isValidEmail("buchhalter@")).toBe(false);
  });

  it("lehnt E-Mail ohne @-Zeichen ab", () => {
    expect(isValidEmail("buchhalter.kanzlei.de")).toBe(false);
  });

  it("lehnt leeren String ab", () => {
    expect(isValidEmail("")).toBe(false);
  });

  it("trimmt Whitespace vor der Prüfung", () => {
    expect(isValidEmail("  buchhalter@kanzlei.de  ")).toBe(true);
  });

  it("lehnt reine Leerzeichen ab", () => {
    expect(isValidEmail("   ")).toBe(false);
  });
});
