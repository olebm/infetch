import fs from "node:fs";
import path from "node:path";
import type { Page } from "playwright";
import { generate as generateTotp } from "otplib";
import { appConfig } from "@/lib/config/env";
import type { AgentCredentials, Recipe, RecipeStep } from "@/portals/agent/types";

export type PlayDownload = {
  filePath: string;
  invoiceDate: string | null;
  originalFilename: string;
};

export type PlayResult = {
  ok: boolean;
  status: "success" | "recipe_broken" | "login_required" | "two_factor" | "captcha" | "no_invoices" | "failed";
  message: string | null;
  downloads: PlayDownload[];
};

const STEP_TIMEOUT_MS = 15_000;
const DEFAULT_NAV_TIMEOUT = 30_000;

export async function playRecipe(
  page: Page,
  recipe: Recipe,
  credentials: AgentCredentials,
  options: { targetYearMonth?: string } = {},
): Promise<PlayResult> {
  const downloads: PlayDownload[] = [];
  try {
    for (const step of [...recipe.loginFlow, ...recipe.navigationFlow]) {
      await executeStep(page, step, credentials);
      // Pruefe nach jedem Schritt auf Friktionspunkte (CAPTCHA, 2FA, Login-Wall)
      const friction = await detectFriction(page);
      if (friction) {
        return { ok: false, status: friction.status, message: friction.message, downloads };
      }
    }

    const rows = await page.$$(recipe.invoiceList.rowSelector);
    if (rows.length === 0) {
      // Vielleicht sind wir auf einer Login-Seite gelandet ohne dass ein Selector throwte
      const friction = await detectFriction(page);
      if (friction) {
        return { ok: false, status: friction.status, message: friction.message, downloads };
      }
      return { ok: false, status: "no_invoices", message: "Keine Rechnungen auf der Seite gefunden.", downloads };
    }

    for (const row of rows) {
      const rowDate = await extractRowDate(row, recipe.invoiceList);
      if (options.targetYearMonth && rowDate && !rowDate.startsWith(options.targetYearMonth)) {
        continue;
      }
      const downloadEl = await row.$(recipe.invoiceList.downloadSelector);
      if (!downloadEl) continue;

      const [download] = await Promise.all([
        page.waitForEvent("download", { timeout: 20_000 }),
        downloadEl.click(),
      ]);
      const suggestedName = download.suggestedFilename();
      const targetDir = path.join(appConfig.invoiceStoragePath, "portal-agent");
      fs.mkdirSync(targetDir, { recursive: true });
      const filePath = path.join(targetDir, `${Date.now()}-${suggestedName}`);
      await download.saveAs(filePath);
      downloads.push({ filePath, invoiceDate: rowDate, originalFilename: suggestedName });
    }

    if (downloads.length === 0) {
      return {
        ok: false,
        status: "no_invoices",
        message: options.targetYearMonth
          ? `Keine Rechnung für ${options.targetYearMonth} gefunden.`
          : "Keine Rechnungen heruntergeladen.",
        downloads,
      };
    }
    return { ok: true, status: "success", message: null, downloads };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);

    // Erst Friktion checken — die Diagnose ist informativer als "timeout"
    const friction = await detectFriction(page).catch(() => null);
    if (friction) {
      return { ok: false, status: friction.status, message: friction.message, downloads };
    }

    if (/timeout|selector .* not found|locator .* not found|getByRole|element.*not found/i.test(message)) {
      return { ok: false, status: "recipe_broken", message: shortMessage(message), downloads };
    }
    return { ok: false, status: "failed", message: shortMessage(message), downloads };
  }
}

type FrictionResult = {
  status: "login_required" | "two_factor" | "captcha";
  message: string;
};

/**
 * Erkennt typische Friktionspunkte am aktuellen Seiten-Zustand:
 *  - CAPTCHA (reCaptcha-iFrame, hCaptcha-Marker)
 *  - 2FA (Code-Eingabefeld, "Verifizierungs"-Wortlaut)
 *  - Login-Wall (Login-URL-Pattern ODER Password-Feld + Email-Feld noch sichtbar)
 *
 * Reihenfolge wichtig: CAPTCHA > 2FA > Login-Wall.
 */
async function detectFriction(page: Page): Promise<FrictionResult | null> {
  try {
    const url = page.url();
    const hasCaptcha = await page
      .evaluate(() => {
        const hosts = ["recaptcha", "captcha", "hcaptcha", "challenges.cloudflare"];
        for (const frame of Array.from(document.querySelectorAll("iframe"))) {
          const src = frame.getAttribute("src") ?? "";
          if (hosts.some((h) => src.includes(h))) return true;
        }
        const text = document.body.innerText.slice(0, 5000).toLowerCase();
        return /captcha|i'm not a robot|ich bin kein roboter/i.test(text);
      })
      .catch(() => false);
    if (hasCaptcha) {
      return { status: "captcha", message: "Portal verlangt ein CAPTCHA — bitte einmal manuell anmelden." };
    }

    const twoFactor = await page
      .evaluate(() => {
        const text = document.body.innerText.slice(0, 5000).toLowerCase();
        if (/(2fa|two[- ]?factor|verifizierungs?code|bestätigungscode|authenticator)/i.test(text)) {
          // Plausibilität: ein Eingabefeld mit kurzer Pattern-Länge
          const inputs = Array.from(document.querySelectorAll("input"));
          return inputs.some((i) => {
            const m = i.maxLength;
            return m > 0 && m <= 8;
          });
        }
        return false;
      })
      .catch(() => false);
    if (twoFactor) {
      return {
        status: "two_factor",
        message: "Portal fordert einen 2FA-Code. Wenn du einen TOTP-Schlüssel hinterlegt hast, lernen wir das beim nächsten Recording.",
      };
    }

    if (looksLikeLoginRedirect(url)) {
      return { status: "login_required", message: "Login abgelaufen — Session erneuern nötig." };
    }
    const stillOnLoginForm = await page
      .evaluate(() => {
        const hasPassword = !!document.querySelector("input[type='password']");
        const hasEmail = !!document.querySelector(
          "input[type='email'], input[name*='user' i], input[autocomplete='username']",
        );
        return hasPassword && hasEmail;
      })
      .catch(() => false);
    if (stillOnLoginForm) {
      return { status: "login_required", message: "Wir sind noch auf einer Anmeldeseite." };
    }
  } catch {
    // Friktions-Check soll nie throwen
  }
  return null;
}

async function executeStep(page: Page, step: RecipeStep, credentials: AgentCredentials) {
  switch (step.type) {
    case "goto":
      await page.goto(step.url, { timeout: DEFAULT_NAV_TIMEOUT, waitUntil: "domcontentloaded" });
      break;
    case "fill": {
      const value = await resolveValueFrom(step.valueFrom, credentials);
      await page.fill(step.selector, value, { timeout: STEP_TIMEOUT_MS });
      break;
    }
    case "click":
      await page.click(step.selector, { timeout: STEP_TIMEOUT_MS });
      break;
    case "waitForUrl":
      await page.waitForURL(step.pattern, { timeout: DEFAULT_NAV_TIMEOUT });
      break;
    case "waitFor":
      await page.waitForSelector(step.selector, { timeout: step.timeoutMs ?? STEP_TIMEOUT_MS });
      break;
    case "press":
      await page.keyboard.press(step.key);
      break;
    case "screenshot":
      await page.screenshot();
      break;
  }
}

async function resolveValueFrom(
  source: "credential.username" | "credential.password" | "totp",
  creds: AgentCredentials,
): Promise<string> {
  if (source === "credential.username") return creds.username;
  if (source === "credential.password") return creds.password;
  if (source === "totp") {
    if (!creds.totpSecret) throw new Error("TOTP-Schlüssel fehlt für dieses Recipe.");
    return generateTotp({ secret: creds.totpSecret });
  }
  throw new Error(`Unbekannte Quelle: ${source}`);
}

async function extractRowDate(
  row: Awaited<ReturnType<Page["$"]>>,
  config: Recipe["invoiceList"],
): Promise<string | null> {
  if (!row) return null;
  try {
    if (config.dateAttribute && config.dateSelector) {
      const el = await row.$(config.dateSelector);
      if (el) {
        const attr = await el.getAttribute(config.dateAttribute);
        return attr ? normalizeDate(attr) : null;
      }
    }
    if (config.dateSelector) {
      const el = await row.$(config.dateSelector);
      if (el) {
        const text = (await el.textContent())?.trim();
        return text ? normalizeDate(text) : null;
      }
    }
    return null;
  } catch {
    return null;
  }
}

function normalizeDate(value: string): string | null {
  const iso = /^(\d{4})-(\d{2})-(\d{2})/.exec(value);
  if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`;
  const ger = /^(\d{2})\.(\d{2})\.(\d{4})/.exec(value);
  if (ger) return `${ger[3]}-${ger[2]}-${ger[1]}`;
  return null;
}

function looksLikeLoginRedirect(url: string): boolean {
  return /\/(login|signin|anmeld(en|ung)|sso)/i.test(url);
}

function shortMessage(message: string): string {
  return message.split("\n")[0].slice(0, 200);
}
