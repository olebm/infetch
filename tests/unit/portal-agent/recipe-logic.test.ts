import { describe, expect, it } from "vitest";
import {
  classifyFriction,
  classifyPlayError,
  normalizeDate,
  resolveValueFrom,
  shouldStopPaginating,
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

  // INFETCH-259: login_required während des loginFlow unterdrücken (eine Login-Seite
  // ist dort der Normalfall), CAPTCHA/2FA aber weiterhin erkennen. Ohne diese Regel
  // brach jeder Login-Flow nach dem ersten Schritt mit login_required ab.
  it("unterdrückt login_required während des Logins (URL-Pattern)", () => {
    const onLoginPage = { ...cleanPage, url: "https://portal.example/login" };
    expect(classifyFriction(onLoginPage)?.status).toBe("login_required");
    expect(classifyFriction(onLoginPage, { duringLogin: true })).toBeNull();
  });

  it("unterdrückt login_required während des Logins (Passwort+Email-Feld)", () => {
    const loginForm = { ...cleanPage, hasPasswordField: true, hasEmailField: true };
    expect(classifyFriction(loginForm)?.status).toBe("login_required");
    expect(classifyFriction(loginForm, { duringLogin: true })).toBeNull();
  });

  it("erkennt CAPTCHA und 2FA auch während des Logins", () => {
    const captcha = { ...cleanPage, hasCaptchaIframe: true };
    expect(classifyFriction(captcha, { duringLogin: true })?.status).toBe("captcha");
    const twoFa = {
      ...cleanPage,
      bodyTextLower: "geben sie ihren bestätigungscode ein",
      hasShortCodeInput: true,
    };
    expect(classifyFriction(twoFa, { duringLogin: true })?.status).toBe("two_factor");
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

describe("shouldStopPaginating", () => {
  const base = { reachedOlderThanSince: false, pageNum: 0, maxPages: 5 };

  it("stoppt, wenn kein paginationSelector konfiguriert ist", () => {
    expect(shouldStopPaginating({ ...base })).toBe(true);
  });

  it("blättert weiter bei paginationSelector und ohne since-Treffer", () => {
    expect(shouldStopPaginating({ ...base, paginationSelector: "a.next" })).toBe(false);
  });

  it("stoppt am Seiten-Cap (pageNum + 1 >= maxPages)", () => {
    expect(
      shouldStopPaginating({ ...base, paginationSelector: "a.next", pageNum: 4, maxPages: 5 }),
    ).toBe(true);
    // maxPages=1 → schon nach der ersten Seite stoppen.
    expect(
      shouldStopPaginating({ ...base, paginationSelector: "a.next", pageNum: 0, maxPages: 1 }),
    ).toBe(true);
  });

  it("stoppt früh, wenn since gesetzt und ältere Rechnungen auf der Seite waren", () => {
    expect(
      shouldStopPaginating({
        ...base,
        paginationSelector: "a.next",
        since: "2026-04-01",
        reachedOlderThanSince: true,
      }),
    ).toBe(true);
  });

  it("blättert weiter, wenn since gesetzt aber noch keine älteren Rechnungen", () => {
    expect(
      shouldStopPaginating({
        ...base,
        paginationSelector: "a.next",
        since: "2026-04-01",
        reachedOlderThanSince: false,
      }),
    ).toBe(false);
  });
});
