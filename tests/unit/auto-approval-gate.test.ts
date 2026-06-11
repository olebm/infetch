import { describe, expect, it } from "vitest";
import { highConfidenceAllowed } from "@/lib/automation/auto-approval";

// INFETCH-272: highConfidenceAllowed ist das reine Sicherheits-Gate für den
// High-Confidence-Auto-Approve. Es schützt den Geldpfad gegen prompt-injizierte
// Rechnungen (die Confidence ist modell-selbstberichtet aus dem PDF-Inhalt):
// Auto-Approve nur unter dem Betrags-Cap UND für einen bekannten Anbieter.
describe("highConfidenceAllowed (INFETCH-272)", () => {
  const CAP = 50_000; // 500 €

  it("erlaubt nur unter dem Cap und für bekannte Anbieter (Grenze inklusiv)", () => {
    expect(highConfidenceAllowed(2_900, CAP, true)).toBe(true);
    expect(highConfidenceAllowed(CAP, CAP, true)).toBe(true);
  });

  it("blockt Beträge über dem Cap — auch bei bekanntem Anbieter (der injizierte Großbetrag)", () => {
    expect(highConfidenceAllowed(CAP + 1, CAP, true)).toBe(false);
    expect(highConfidenceAllowed(99_999_900, CAP, true)).toBe(false);
  });

  it("blockt unbekannte Anbieter — auch bei kleinem Betrag (der erfundene Vendor)", () => {
    expect(highConfidenceAllowed(100, CAP, false)).toBe(false);
  });

  it("blockt, wenn beides fehlt", () => {
    expect(highConfidenceAllowed(99_999_900, CAP, false)).toBe(false);
  });
});
