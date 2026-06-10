import { describe, expect, it } from "vitest";
import {
  classifyFriction,
  classifyPlayError,
  normalizeDate,
  resolveValueFrom,
  type FrictionSnapshot,
} from "@/portals/agent/recipe-player";
import type { AgentCredentials } from "@/portals/agent/types";

// INFETCH-151: Basis-Tests für die browser-unabhängige Kernlogik des Portal-Agents.
// Diese laufen im Node-Env (kein Chromium) und damit im CI-`npm run test`-Job.
// Das echte Replay-mit-Download (Playwright) gehört in tests/e2e (separater Gate).

const cleanPage: FrictionSnapshot = {
  url: "https://portal.example/rechnungen",
  hasCaptchaIframe: false,
  bodyTextLower: "ihre rechnungen im überblick",
  hasShortCodeInput: false,
  hasPasswordField: false,
  hasEmailField: false,
};

describe("classifyFriction", () => {
  it("erkennt CAPTCHA per iframe-Marker", () => {
    expect(classifyFriction({ ...cleanPage, hasCaptchaIframe: true })?.status).toBe("captcha");
  });

  it("erkennt CAPTCHA per Wortlaut", () => {
    const s = { ...cleanPage, bodyTextLower: "bitte bestätigen: ich bin kein roboter" };
    expect(classifyFriction(s)?.status).toBe("captcha");
  });

  it("erkennt 2FA nur bei Wortlaut UND kurzem Code-Feld", () => {
    const withInput = {
      ...cleanPage,
      bodyTextLower: "geben sie ihren bestätigungscode ein",
      hasShortCodeInput: true,
    };
    expect(classifyFriction(withInput)?.status).toBe("two_factor");
  });

  it("klassifiziert 2FA-Wortlaut OHNE Code-Feld nicht als 2FA", () => {
    const noInput = { ...cleanPage, bodyTextLower: "bestätigungscode wurde versendet" };
    // Sauberer Rest → keine Friktion.
    expect(classifyFriction(noInput)).toBeNull();
  });

  it("erkennt Login-Wall per URL-Pattern", () => {
    expect(classifyFriction({ ...cleanPage, url: "https://portal.example/login" })?.status).toBe(
      "login_required",
    );
  });

  it("erkennt Login-Wall per Passwort- + Email-Feld", () => {
    const s = { ...cleanPage, hasPasswordField: true, hasEmailField: true };
    expect(classifyFriction(s)?.status).toBe("login_required");
  });

  it("gibt für eine saubere (eingeloggte) Seite null zurück", () => {
    expect(classifyFriction(cleanPage)).toBeNull();
  });

  it("priorisiert CAPTCHA vor 2FA, wenn beides vorhanden ist", () => {
    const both = {
      ...cleanPage,
      hasCaptchaIframe: true,
      bodyTextLower: "bestätigungscode captcha",
      hasShortCodeInput: true,
    };
    expect(classifyFriction(both)?.status).toBe("captcha");
  });
});

describe("classifyPlayError", () => {
  it.each([
    ["page.click: Timeout 15000ms exceeded.", "recipe_broken"],
    ["selector div.invoice not found", "recipe_broken"],
    ["locator button not found in DOM", "recipe_broken"],
    ["getByRole('button', { name: 'Download' }) resolved to 0 elements", "recipe_broken"],
    ["element is not found", "recipe_broken"],
    ["net::ERR_CONNECTION_REFUSED", "failed"],
    ["Download fehlgeschlagen: Datei leer", "failed"],
  ])("%s → %s", (message, expected) => {
    expect(classifyPlayError(message)).toBe(expected);
  });
});

describe("resolveValueFrom", () => {
  const creds: AgentCredentials = {
    username: "max@example.com",
    password: "s3cret!",
    // otplib v13 verlangt ≥16 Byte → ein 32-stelliges Base32-Secret (20 Byte).
    // Hinweis: die Connect-Action erlaubt aktuell schon 16 Zeichen (10 Byte),
    // die otplib ablehnt — siehe Folge-Issue TOTP-Secret-Validierung.
    totpSecret: "JBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXP",
  };

  it("löst Benutzername und Passwort auf", async () => {
    expect(await resolveValueFrom("credential.username", creds)).toBe("max@example.com");
    expect(await resolveValueFrom("credential.password", creds)).toBe("s3cret!");
  });

  it("generiert einen 6-stelligen TOTP-Code aus dem Secret", async () => {
    const token = await resolveValueFrom("totp", creds);
    expect(token).toMatch(/^\d{6}$/);
  });

  it("wirft einen klaren Fehler, wenn das TOTP-Secret fehlt", async () => {
    const noTotp: AgentCredentials = { username: "a", password: "b" };
    await expect(resolveValueFrom("totp", noTotp)).rejects.toThrow(/TOTP-Schlüssel fehlt/);
  });

  it("wirft bei unbekannter Quelle", async () => {
    await expect(resolveValueFrom("bogus" as unknown as "totp", creds)).rejects.toThrow(
      /Unbekannte Quelle/,
    );
  });
});

describe("normalizeDate", () => {
  it("normalisiert ISO-Datum", () => {
    expect(normalizeDate("2025-03-15T10:00:00Z")).toBe("2025-03-15");
  });

  it("normalisiert deutsches Datum (DD.MM.YYYY)", () => {
    expect(normalizeDate("15.03.2025")).toBe("2025-03-15");
  });

  it("gibt null bei nicht parsebarem Wert", () => {
    expect(normalizeDate("März 2025")).toBeNull();
    expect(normalizeDate("")).toBeNull();
  });
});
