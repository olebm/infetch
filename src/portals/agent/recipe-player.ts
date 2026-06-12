import fs from "node:fs";
import path from "node:path";
import type { Page } from "playwright";
import { appConfig } from "@/lib/config/env";
import type { AgentCredentials, Recipe, RecipeStep } from "@/portals/agent/types";

export type PlayDownload = {
  filePath: string;
  invoiceDate: string | null;
  originalFilename: string;
};

export type PlayResult = {
  ok: boolean;
  status:
    | "success"
    | "recipe_broken"
    | "login_required"
    | "two_factor"
    | "captcha"
    | "no_invoices"
    | "failed";
  message: string | null;
  downloads: PlayDownload[];
};

const STEP_TIMEOUT_MS = 15_000;
const DEFAULT_NAV_TIMEOUT = 30_000;

export async function playRecipe(
  page: Page,
  recipe: Recipe,
  credentials: AgentCredentials,
  options: { targetYearMonth?: string; since?: string; allowedVendorUrl?: string | null } = {},
): Promise<PlayResult> {
  const downloads: PlayDownload[] = [];
  // Egress-Härtung (INFETCH-273): Ohne vertrauenswürdige Vendor-URL lässt sich die
  // Domain-Bindung nicht erzwingen → fail-closed statt offen ausführen.
  if (!options.allowedVendorUrl) {
    return {
      ok: false,
      status: "failed",
      message: "Kein Vendor-URL hinterlegt — Portal-Abruf aus Sicherheitsgründen abgebrochen.",
      downloads,
    };
  }
  try {
    const steps = [...recipe.loginFlow, ...recipe.navigationFlow];
    for (let i = 0; i < steps.length; i++) {
      const step = steps[i];
      await executeStep(page, step, credentials, options.allowedVendorUrl);
      // Egress-Recheck NACH dem Schritt (INFETCH-273): fängt 30x-Redirects
      // (Playwright folgt automatisch) und click/submit-getriebene Navigation,
      // die der goto-Pre-Check nicht sieht. Direkt zurückgeben (nicht werfen),
      // um nicht via detectFriction mit der fremden Seite zu interagieren.
      if (!egressAllowed(page.url(), options.allowedVendorUrl)) {
        return {
          ok: false,
          status: "failed",
          message: `Navigation auf fremde Domain blockiert (Security): ${page.url()}`,
          downloads,
        };
      }
      // Friktion nach jedem Schritt prüfen (CAPTCHA, 2FA, Login-Wall). Während des
      // loginFlow ist eine Login-Seite erwartbar → login_required dort unterdrücken
      // (INFETCH-259); CAPTCHA/2FA bleiben aktiv. Ein fehlgeschlagener Login fällt
      // danach über den 0-Zeilen-/catch-Pfad (volle detectFriction) als login_required.
      const friction = await detectFriction(page, { duringLogin: i < recipe.loginFlow.length });
      if (friction) {
        return { ok: false, status: friction.status, message: friction.message, downloads };
      }
    }

    const rowSelector = recipe.invoiceList.rowSelector;
    const paginationSelector = recipe.invoiceList.paginationSelector;
    const maxPages = recipe.invoiceList.maxPages ?? 5;

    // Pagination (INFETCH-281): Seite für Seite durchblättern, bis maxPages erreicht,
    // keine weitere Seite vorhanden, oder der since-Filter signalisiert „ab hier alt".
    for (let pageNum = 0; pageNum < maxPages; pageNum++) {
      const rows = await page.$$(rowSelector);
      if (rows.length === 0) {
        if (pageNum === 0) {
          // Erste Seite leer → evtl. Login-Wall ohne geworfenen Selector-Fehler.
          const friction = await detectFriction(page);
          if (friction) {
            return { ok: false, status: friction.status, message: friction.message, downloads };
          }
          return {
            ok: false,
            status: "no_invoices",
            message: "Keine Rechnungen auf der Seite gefunden.",
            downloads,
          };
        }
        break; // Folgeseite leer → Ende der Liste.
      }

      let reachedOlderThanSince = false;
      for (const row of rows) {
        const rowDate = await extractRowDate(row, recipe.invoiceList);
        if (options.since && rowDate && rowDate < options.since) reachedOlderThanSince = true;
        if (!shouldFetchRow(rowDate, options)) continue;
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

      if (
        shouldStopPaginating({
          paginationSelector,
          since: options.since,
          reachedOlderThanSince,
          pageNum,
          maxPages,
        }) ||
        !paginationSelector
      ) {
        break;
      }
      const signature = await pageSignature(page, rowSelector);
      const advanced = await advancePage(page, paginationSelector, rowSelector, signature);
      if (!advanced) break;
      // Egress-Recheck (INFETCH-273) auch für die Pagination-Navigation: ein vergiftetes
      // Recipe darf den „next"-Klick nicht nutzen, um auf eine Fremd-Domain zu wechseln.
      if (!egressAllowed(page.url(), options.allowedVendorUrl)) {
        return {
          ok: false,
          status: "failed",
          message: `Navigation auf fremde Domain blockiert (Security): ${page.url()}`,
          downloads,
        };
      }
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

    return {
      ok: false,
      status: classifyPlayError(message),
      message: shortMessage(message),
      downloads,
    };
  }
}

/**
 * Unterscheidet einen "broken recipe" (Selector/Locator passt nicht mehr → Re-Record
 * sinnvoll) von einem sonstigen Fehler (failed). Rein und in Vitest testbar.
 */
export function classifyPlayError(message: string): "recipe_broken" | "failed" {
  return /timeout|selector .* not found|locator .* not found|getByRole|element.*not found/i.test(
    message,
  )
    ? "recipe_broken"
    : "failed";
}

export type FrictionResult = {
  status: "login_required" | "two_factor" | "captcha";
  message: string;
};

// Browser-unabhängiger Snapshot des Seiten-Zustands — wird von detectFriction aus
// der echten Seite befüllt und von classifyFriction (rein, ohne Playwright und
// daher in Vitest testbar) bewertet.
export type FrictionSnapshot = {
  url: string;
  hasCaptchaIframe: boolean;
  bodyTextLower: string;
  hasShortCodeInput: boolean;
  hasPasswordField: boolean;
  hasEmailField: boolean;
};

/**
 * Reine Friktions-Klassifikation aus einem Seiten-Snapshot:
 *  - CAPTCHA (reCaptcha-iFrame/hCaptcha-Marker oder Wortlaut)
 *  - 2FA (Code-Eingabefeld + "Verifizierungs"-Wortlaut)
 *  - Login-Wall (Login-URL-Pattern ODER Password- + Email-Feld sichtbar)
 *
 * Reihenfolge wichtig: CAPTCHA > 2FA > Login-Wall.
 */
export function classifyFriction(
  s: FrictionSnapshot,
  opts: { duringLogin?: boolean } = {},
): FrictionResult | null {
  if (s.hasCaptchaIframe || /captcha|i'm not a robot|ich bin kein roboter/i.test(s.bodyTextLower)) {
    return {
      status: "captcha",
      message: "Portal verlangt ein CAPTCHA — bitte einmal manuell anmelden.",
    };
  }
  if (
    /(2fa|two[- ]?factor|verifizierungs?code|bestätigungscode|authenticator)/i.test(
      s.bodyTextLower,
    ) &&
    s.hasShortCodeInput
  ) {
    return {
      status: "two_factor",
      message:
        "Portal fordert einen 2FA-Code. Wenn du einen TOTP-Schlüssel hinterlegt hast, lernen wir das beim nächsten Recording.",
    };
  }
  // login_required heißt „auf eine Anmeldeseite zurückgeworfen" — nur AUSSERHALB des
  // Login-Flows ein Fehler. Während des Logins ist die Login-Seite der Normalfall
  // (URL-Pattern bzw. Passwort+Email-Feld); CAPTCHA/2FA werden oben weiterhin erkannt.
  if (!opts.duringLogin) {
    if (looksLikeLoginRedirect(s.url)) {
      return { status: "login_required", message: "Login abgelaufen — Session erneuern nötig." };
    }
    if (s.hasPasswordField && s.hasEmailField) {
      return { status: "login_required", message: "Wir sind noch auf einer Anmeldeseite." };
    }
  }
  return null;
}

/**
 * Liest den Friktions-Snapshot aus der echten Seite und delegiert die Bewertung an
 * classifyFriction. Soll nie throwen.
 */
async function detectFriction(
  page: Page,
  opts: { duringLogin?: boolean } = {},
): Promise<FrictionResult | null> {
  try {
    const snapshot = await page.evaluate(() => {
      const hosts = ["recaptcha", "captcha", "hcaptcha", "challenges.cloudflare"];
      const hasCaptchaIframe = Array.from(document.querySelectorAll("iframe")).some((frame) =>
        hosts.some((h) => (frame.getAttribute("src") ?? "").includes(h)),
      );
      const bodyTextLower = (document.body?.innerText ?? "").slice(0, 5000).toLowerCase();
      const hasShortCodeInput = Array.from(document.querySelectorAll("input")).some((i) => {
        const m = (i as HTMLInputElement).maxLength;
        return m > 0 && m <= 8;
      });
      const hasPasswordField = !!document.querySelector("input[type='password']");
      const hasEmailField = !!document.querySelector(
        "input[type='email'], input[name*='user' i], input[autocomplete='username']",
      );
      return {
        hasCaptchaIframe,
        bodyTextLower,
        hasShortCodeInput,
        hasPasswordField,
        hasEmailField,
      };
    });
    return classifyFriction({ url: page.url(), ...snapshot }, opts);
  } catch {
    // Friktions-Check soll nie throwen
    return null;
  }
}

async function executeStep(
  page: Page,
  step: RecipeStep,
  credentials: AgentCredentials,
  allowedVendorUrl: string | null | undefined,
) {
  switch (step.type) {
    case "goto":
      // Egress-Schutz (INFETCH-265): nur auf die Domain des Vendors navigieren.
      // Verhindert, dass ein vergiftetes (Community-)Recipe die Browser-Session
      // inkl. Credentials auf eine Fremd-Domain leitet.
      if (!egressAllowed(step.url, allowedVendorUrl)) {
        throw new Error(`Navigation auf fremde Domain blockiert (Security): ${step.url}`);
      }
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

export async function resolveValueFrom(
  source: "credential.username" | "credential.password" | "totp",
  creds: AgentCredentials,
): Promise<string> {
  if (source === "credential.username") return creds.username;
  if (source === "credential.password") return creds.password;
  if (source === "totp") {
    if (!creds.totpSecret) throw new Error("TOTP-Schlüssel fehlt für dieses Recipe.");
    // Lazy-Import: otplib zieht @scure/base (pure ESM) — als Top-Level-Import bräche
    // das jeden CJS-Consumer (u. a. den Playwright-Replay-E2E). Nur im TOTP-Pfad laden.
    const { generate } = await import("otplib");
    return generate({ secret: creds.totpSecret });
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

// Bekannte zweistufige Public-Suffixe — damit z.B. portal.kunde.co.uk korrekt auf
// die Registrable-Domain kunde.co.uk reduziert wird (nicht co.uk).
const KNOWN_MULTI_TLDS = new Set([
  "co.uk",
  "org.uk",
  "com.au",
  "co.jp",
  "co.nz",
  "com.br",
  "co.za",
]);

/** Registrable-Domain (eTLD+1) eines Hosts — pragmatische Heuristik. */
function registrableDomain(host: string): string {
  const parts = host.toLowerCase().replace(/\.$/, "").split(".").filter(Boolean);
  if (parts.length <= 2) return parts.join(".");
  const lastTwo = parts.slice(-2).join(".");
  return KNOWN_MULTI_TLDS.has(lastTwo) ? parts.slice(-3).join(".") : lastTwo;
}

/**
 * Egress-Sicherheits-Check (INFETCH-265): darf der Agent zu `targetUrl` navigieren?
 * Erlaubt nur die Registrable-Domain des VERTRAUENSWÜRDIGEN vendorUrl (vom Kunden
 * beim Verbinden eingegeben) und deren Subdomains. Schützt vor vergifteten
 * Community-Recipes, die Credentials auf eine Fremd-Domain leiten würden.
 * vendorUrl fehlt/unparsebar → nicht erzwingbar (true); targetUrl unparsebar → false.
 */
export function hostAllowedForVendor(
  targetUrl: string,
  vendorUrl: string | null | undefined,
): boolean {
  if (!vendorUrl) return true;
  let vendorHost: string;
  try {
    vendorHost = new URL(vendorUrl).hostname;
  } catch {
    return true;
  }
  try {
    const targetHost = new URL(targetUrl).hostname;
    return registrableDomain(targetHost) === registrableDomain(vendorHost);
  } catch {
    return false;
  }
}

/**
 * Laufzeit-Egress-Entscheidung (INFETCH-273): Darf der Agent JETZT auf `targetUrl`
 * sein/navigieren? Strikter als hostAllowedForVendor — ohne vertrauenswürdige
 * vendorUrl ist die Domain-Bindung nicht erzwingbar, also fail-closed (false statt
 * "nicht erzwingbar → true"). Genutzt für den goto-Pre-Check UND den Post-
 * Navigations-Recheck, der Redirects (Playwright folgt 30x automatisch) und
 * click/submit-getriebene Navigation abfängt, die ein reiner goto-Check nicht sieht.
 */
export function egressAllowed(targetUrl: string, vendorUrl: string | null | undefined): boolean {
  if (!vendorUrl) return false;
  return hostAllowedForVendor(targetUrl, vendorUrl);
}

/**
 * Reine Entscheidung, ob eine Rechnungs-Zeile geladen werden soll.
 *  - targetYearMonth: nur Zeilen dieses Monats (YYYY-MM).
 *  - since (INFETCH-52): nur Zeilen ab diesem Datum (YYYY-MM-DD) — der letzte
 *    erfolgreiche Lauf; ältere gelten als bereits geholt. ISO-Datumsstrings
 *    vergleichen sich lexikografisch korrekt.
 * Ohne rowDate wird konservativ geladen (lieber laden + dedupen als verpassen).
 */
export function shouldFetchRow(
  rowDate: string | null,
  options: { targetYearMonth?: string; since?: string },
): boolean {
  if (rowDate === null) return true;
  if (options.targetYearMonth && !rowDate.startsWith(options.targetYearMonth)) return false;
  if (options.since && rowDate < options.since) return false;
  return true;
}

/**
 * Reine, testbare Entscheidung, ob die Pagination beendet werden soll:
 *  - kein paginationSelector konfiguriert, ODER
 *  - since gesetzt UND auf der aktuellen Seite tauchten bereits ältere Rechnungen auf
 *    (newest-first angenommen → Folgeseiten sind erst recht älter).
 */
export function shouldStopPaginating(input: {
  paginationSelector?: string;
  since?: string;
  reachedOlderThanSince: boolean;
  pageNum: number;
  maxPages: number;
}): boolean {
  if (!input.paginationSelector) return true;
  if (input.pageNum + 1 >= input.maxPages) return true; // Seiten-Cap erreicht
  if (input.since && input.reachedOlderThanSince) return true;
  return false;
}

/** Signatur der aktuell sichtbaren Zeilen — erkennt, ob ein Seitenwechsel gegriffen hat. */
async function pageSignature(page: Page, rowSelector: string): Promise<string> {
  return page.$$eval(rowSelector, (rows) => rows.map((r) => r.textContent ?? "").join("|"));
}

/**
 * Klickt das Pagination-Element und wartet, bis sich die Zeilen-Signatur ändert.
 * Liefert false, wenn es kein (aktives) Next-Element gibt oder sich nichts ändert
 * (= letzte Seite). Funktioniert für echte Navigation UND SPA-Re-Render.
 */
async function advancePage(
  page: Page,
  paginationSelector: string,
  rowSelector: string,
  previousSignature: string,
): Promise<boolean> {
  const nextEl = await page.$(paginationSelector);
  if (!nextEl) return false;
  const disabled = await nextEl.evaluate(
    (el) =>
      (el as HTMLButtonElement).disabled === true ||
      el.getAttribute("aria-disabled") === "true" ||
      el.classList.contains("disabled"),
  );
  if (disabled) return false;
  await nextEl.click().catch(() => {});
  try {
    await page.waitForFunction(
      ([sel, prev]) =>
        Array.from(document.querySelectorAll(sel))
          .map((r) => r.textContent ?? "")
          .join("|") !== prev,
      [rowSelector, previousSignature] as [string, string],
      { timeout: 8_000 },
    );
    return true;
  } catch {
    return false;
  }
}

export function normalizeDate(value: string): string | null {
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
