import { describe, expect, it } from "vitest";
import { isValidEmail } from "@/lib/validation/email";

describe("isValidEmail", () => {
  it("akzeptiert gueltige Adressen", () => {
    expect(isValidEmail("buchhalter@kanzlei.de")).toBe(true);
    expect(isValidEmail("a.b+tag@sub.example.co.uk")).toBe(true);
    expect(isValidEmail("  trimmed@example.com  ")).toBe(true);
  });

  it("lehnt offensichtliche Tippfehler ab", () => {
    expect(isValidEmail("buchhalter@")).toBe(false); // fehlende Domain/TLD
    expect(isValidEmail("buchhalter@kanzlei")).toBe(false); // fehlende TLD
    expect(isValidEmail("kanzlei.de")).toBe(false); // fehlendes @
    expect(isValidEmail("foo @bar.de")).toBe(false); // Leerzeichen
    expect(isValidEmail("foo@bar .de")).toBe(false); // Leerzeichen in Domain
  });

  it("lehnt leere/fehlende Werte ab", () => {
    expect(isValidEmail("")).toBe(false);
    expect(isValidEmail(null)).toBe(false);
    expect(isValidEmail(undefined)).toBe(false);
  });
});
