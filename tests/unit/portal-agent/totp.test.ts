import { describe, expect, it } from "vitest";
import { isUsableTotpSecret } from "@/portals/totp";

// INFETCH-260: Die Connect-Validierung ließ 16-stellige Secrets (10 Byte) durch,
// die otplib v13 (≥16 Byte) zur Laufzeit mit SecretTooShortError ablehnt.
// isUsableTotpSecret prüft gegen otplibs echte Regeln (Trial-Generierung).

describe("isUsableTotpSecret", () => {
  it("akzeptiert ein gültiges 32-stelliges Base32-Secret (20 Byte)", async () => {
    expect(await isUsableTotpSecret("JBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXP")).toBe(true);
  });

  it("lehnt ein zu kurzes 16-stelliges Secret ab (10 Byte < 16 Byte)", async () => {
    expect(await isUsableTotpSecret("JBSWY3DPEHPK3PXP")).toBe(false);
  });

  it("lehnt leere und Nicht-Base32-Eingaben ab", async () => {
    expect(await isUsableTotpSecret("")).toBe(false);
    expect(await isUsableTotpSecret("not-base32!!!")).toBe(false);
  });
});
