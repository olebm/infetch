/**
 * Agent-Connector — der Einstiegspunkt fuer Portal-Abrufe.
 *
 * Ablauf:
 *   1. Recipe aus DB laden (oder Seed-Recipe einspielen, wenn keine vorhanden)
 *   2. Browser starten, vorhandene Session laden (Cookies)
 *   3. Recipe deterministisch abspielen
 *   4. Bei Erfolg: Downloads zurueckgeben, Recipe-Erfolg markieren
 *   5. Bei Fehlschlag: je nach Status verschiedene Recovery-Strategien
 *      - login_required -> Session invalidieren, einmal mit frischem Login retry
 *      - recipe_broken (>=2 Fails) -> Recorder anwerfen, neue Version speichern, retry
 *      - captcha/two_factor -> sofort an UI eskalieren
 */

import fs from "node:fs/promises";
import path from "node:path";
// Patchright ist ein API-kompatibler Playwright-Drop-in mit gepatchtem Chromium,
// das gängige Bot-Detection (navigator.webdriver, CDP-Leaks) maskiert. Runtime
// kommt aus patchright; projektweit bleiben die playwright-Typen — daher der
// lokale Cast am Import-Boundary (beide sind strukturell playwright-core).
import { chromium as patchrightChromium } from "patchright";
import type { Browser, BrowserContext, Page } from "playwright";

const chromium = patchrightChromium as unknown as typeof import("playwright").chromium;
import { appConfig } from "@/lib/config/env";
import { readPortalCredential, getPortalAccountOrg } from "@/portals/credential-meta";
import { findVendorByCanonicalKey } from "@/lib/db/queries";
import { canRecordPortalRecipe } from "@/lib/tier";
import { playRecipe, type PlayResult } from "@/portals/agent/recipe-player";
import { recordRecipe } from "@/portals/agent/recipe-recorder";
import { maskSensitiveInputs } from "@/portals/agent/screenshot-redaction";
import { pruneFailureArtifacts } from "@/portals/agent/failure-artifacts";
import {
  getActiveRecipe,
  getLastSuccessfulRunAt,
  logRun,
  markRecipeFailure,
  markRecipeSuccess,
  saveRecipe,
} from "@/portals/agent/recipe-cache";
import {
  getBrowserSession,
  invalidateBrowserSession,
  saveBrowserSession,
} from "@/portals/agent/session-store";
import { getSeedRecipe } from "@/portals/agent/seeds";
import type { AgentCredentials, Recipe, RunResult, RunStatus } from "@/portals/agent/types";

export type AgentRunInput = {
  vendorKey: string;
  targetYearMonth?: string;
  headless?: boolean;
  /**
   * Optional: shared Browser-Instance (z.B. fuer Cron-Laeufe mit mehreren Vendors hintereinander).
   * Wenn gesetzt, wird die Browser-Lifecycle nicht in dieser Funktion verwaltet —
   * der Aufrufer ist fuer browser.close() zustaendig.
   */
  sharedBrowser?: Browser;
};

const RECIPE_FAILURES_BEFORE_RECORD = 2;

export async function runAgentForVendor(input: AgentRunInput): Promise<RunResult> {
  const start = Date.now();
  // Besitzende Org auflösen (für Kostenbremse + org-attribuierte Run-Logs).
  const organizationId = await getPortalAccountOrg(input.vendorKey);
  const credentials = await loadCredentials(input.vendorKey, organizationId);
  // since-Filter (INFETCH-52): nur Rechnungen ab dem letzten erfolgreichen Lauf
  // holen. Beim Erstlauf (kein Erfolg) ist es undefined → Voll-Scan.
  const since = (await getLastSuccessfulRunAt(input.vendorKey, organizationId)) ?? undefined;

  let recipeRow = await getActiveRecipe(input.vendorKey);
  let recipe: Recipe | null = recipeRow?.recipe ?? null;
  if (!recipe) {
    const seed = getSeedRecipe(input.vendorKey);
    if (seed) {
      recipeRow = await saveRecipe({
        vendorKey: input.vendorKey,
        recipe: seed,
        recordedBy: "local",
      });
      recipe = seed;
    }
  }

  // Egress-Allowlist (INFETCH-265): die vertrauenswürdige Vendor-Domain kommt aus
  // den vom Kunden gespeicherten Vendor-Stammdaten (portalLoginUrl) — NICHT aus dem
  // evtl. aus der Community stammenden Recipe. Replay darf nur dorthin navigieren.
  const trustedVendor = await findVendorByCanonicalKey(input.vendorKey);
  const allowedVendorUrl = trustedVendor?.portalLoginUrl ?? recipe?.loginUrl ?? null;

  if (!credentials) {
    return await failureResult(
      input.vendorKey,
      recipeRow?.id ?? null,
      "replay",
      "login_required",
      "Kein Login gespeichert. Bitte unter Einstellungen verbinden.",
      Date.now() - start,
      0,
      0,
      organizationId,
    );
  }

  const headless = input.headless ?? appConfig.portalAgent.headless;
  const browser =
    input.sharedBrowser ??
    (await chromium.launch({
      headless,
      slowMo: appConfig.portalAgent.slowMoMs > 0 ? appConfig.portalAgent.slowMoMs : undefined,
      args: ["--disable-blink-features=AutomationControlled", "--disable-dev-shm-usage"],
    }));
  if (appConfig.portalAgent.verbose) {
    console.log(
      `[portal-agent] vendor=${input.vendorKey} headless=${headless} slowMo=${appConfig.portalAgent.slowMoMs}ms`,
    );
  }
  const ownsBrowser = !input.sharedBrowser;
  let context: BrowserContext | null = null;
  let page: Page | null = null;

  try {
    const session = await getBrowserSession(input.vendorKey);
    context = await browser.newContext({
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      storageState: session ? (session.storageState as any) : undefined,
      locale: "de-DE",
      timezoneId: "Europe/Berlin",
      viewport: { width: 1280, height: 800 },
      // Kein hartkodierter userAgent — patchright/Chromium nutzt die zur echten
      // Browser-Version + OS passende UA (eine fixe Mac-UA im Linux-Container wäre
      // selbst ein Detection-Tell).
    });
    page = await context.newPage();

    let playResult: PlayResult | null = null;
    let mode: "replay" | "record" | "replay_then_record" = "replay";
    let llmCalls = 0;
    let llmCostCents = 0;

    // Erster Versuch: Recipe abspielen (falls vorhanden)
    if (recipe) {
      playResult = await playRecipe(page, recipe, credentials, {
        targetYearMonth: input.targetYearMonth,
        since,
        allowedVendorUrl,
      });

      // Session-Recovery: bei login_required einmal Session leeren + neu versuchen
      if (!playResult.ok && playResult.status === "login_required" && session) {
        await invalidateBrowserSession(input.vendorKey);
        try {
          await context.close();
        } catch {
          // ignore
        }
        context = await browser.newContext({
          locale: "de-DE",
          timezoneId: "Europe/Berlin",
          viewport: { width: 1280, height: 800 },
          // siehe oben: native UA von patchright, kein hartkodierter Wert.
        });
        page = await context.newPage();
        playResult = await playRecipe(page, recipe, credentials, {
          targetYearMonth: input.targetYearMonth,
          since,
          allowedVendorUrl,
        });
      }

      // Erfolg/Fehler in Recipe-Statistik vermerken
      if (playResult.ok && recipeRow) {
        await markRecipeSuccess(recipeRow.id);
      } else if (!playResult.ok && playResult.status === "recipe_broken" && recipeRow) {
        await markRecipeFailure(recipeRow.id);
      }
    }

    // Re-Record-Logik: nur wenn kein Recipe vorhanden ODER Recipe nach Fail-Schwelle als broken markiert
    const recipeIsBroken =
      recipeRow?.failureCount !== undefined &&
      recipeRow.failureCount + 1 >= RECIPE_FAILURES_BEFORE_RECORD;
    const shouldRerecord =
      !recipe || (playResult?.status === "recipe_broken" && !playResult.ok && recipeIsBroken);

    // Kostenbremse: Recording macht Mistral-Calls. Vor dem Recorder das
    // Monats-Budget der Org prüfen — bei Erschöpfung abbrechen OHNE LLM-Call.
    const budget = shouldRerecord ? await canRecordPortalRecipe(organizationId) : null;
    if (shouldRerecord && budget && !budget.allowed) {
      playResult = {
        ok: false,
        status: "failed",
        message: `Recording-Budget erschöpft (${budget.current}/${budget.max} Aufnahmen diesen Monat). Neue Aufnahmen ab dem Folgemonat — oder Tarif anheben.`,
        downloads: playResult?.downloads ?? [],
      };
      // mode bleibt "replay" — es fand kein Recording statt.
    } else if (shouldRerecord) {
      mode = playResult ? "replay_then_record" : "record";
      const loginUrl = recipe?.loginUrl ?? (await deriveLoginUrl(input.vendorKey));

      // Frischer Context fuer das Recording (sauber starten)
      try {
        await context.close();
      } catch {
        // ignore
      }
      context = await browser.newContext();
      page = await context.newPage();

      const recorded = await recordRecipe({
        page,
        vendorKey: input.vendorKey,
        loginUrl,
        credentials,
      });
      llmCalls = recorded.llmCalls;
      llmCostCents = recorded.llmCostCents;

      if (recorded.ok && recorded.recipe) {
        // Validation-Step: einmal mit der neuen Recipe replay-testen, im selben Context
        const saved = await saveRecipe({ vendorKey: input.vendorKey, recipe: recorded.recipe });
        recipeRow = saved;
        playResult = await playRecipe(page, recorded.recipe, credentials, {
          targetYearMonth: input.targetYearMonth,
          since,
          allowedVendorUrl,
        });
        if (playResult.ok) await markRecipeSuccess(saved.id);
        else await markRecipeFailure(saved.id);
      } else {
        playResult = {
          ok: false,
          status: "failed",
          message: recorded.errorMessage ?? "Recipe konnte nicht aufgenommen werden.",
          downloads: [],
        };
      }
    }

    // Session-Snapshot speichern (oder invalidieren) basierend auf Ergebnis
    if (playResult?.ok) {
      try {
        const storage = await context.storageState();
        saveBrowserSession({ vendorKey: input.vendorKey, storageState: storage });
      } catch {
        // Storage-State kann fehlschlagen — nicht kritisch
      }
    } else if (playResult?.status === "login_required") {
      invalidateBrowserSession(input.vendorKey);
    }

    const durationMs = Date.now() - start;
    const status = (playResult?.status ?? "failed") as RunStatus;
    const message = playResult?.message ?? null;

    if (!playResult?.ok && appConfig.portalAgent.screenshotOnFailure && page) {
      try {
        const debugDir = path.join(appConfig.logStoragePath, "portal-failures");
        await fs.mkdir(debugDir, { recursive: true });
        // Retention: alte Debug-Artefakte best-effort entfernen (AC3).
        await pruneFailureArtifacts(debugDir, Date.now());
        // INFETCH-266: Eingabefelder maskieren, BEVOR der Screenshot entsteht.
        // Fail-closed — schlaegt das Masking fehl, springt der catch und es
        // wird KEIN (unmaskierter) Screenshot gespeichert.
        await page.evaluate(maskSensitiveInputs);
        const stamp = new Date().toISOString().replace(/[:.]/g, "-");
        const screenshotPath = path.join(debugDir, `${input.vendorKey}-${stamp}.png`);
        await page.screenshot({ path: screenshotPath, fullPage: true });
        if (appConfig.portalAgent.verbose) {
          console.log(`[portal-agent] failure screenshot saved (redacted): ${screenshotPath}`);
        }
      } catch {
        // Screenshot ist Best-Effort — Fehler hier sind unkritisch (inkl.
        // fehlgeschlagenem Masking: dann bewusst KEIN Screenshot).
      }
    }

    await logRun({
      vendorKey: input.vendorKey,
      recipeId: recipeRow?.id ?? null,
      mode,
      status,
      invoicesFound: playResult?.downloads.length ?? 0,
      durationMs,
      errorMessage: message,
      llmCalls,
      llmCostCents,
      organizationId,
    });

    return {
      vendorKey: input.vendorKey,
      recipeId: recipeRow?.id ?? null,
      mode,
      status,
      invoicesFound: playResult?.downloads.length ?? 0,
      durationMs,
      errorMessage: message,
      llmCalls,
      llmCostCents,
      downloads: playResult?.downloads ?? [],
    };
  } finally {
    try {
      await context?.close();
    } catch {
      // ignore
    }
    if (ownsBrowser) {
      try {
        await browser.close();
      } catch {
        // ignore
      }
    }
  }
}

async function loadCredentials(
  vendorKey: string,
  organizationId: string | null,
): Promise<AgentCredentials | null> {
  const meta = await readPortalCredential(vendorKey, organizationId);
  if (!meta) return null;
  const { readCredentialSecret } = await import("@/lib/secrets/credential-store");
  const totpSecret =
    (await readCredentialSecret({ scope: "totp", ownerId: vendorKey, organizationId })) ??
    undefined;
  return { username: meta.username, password: meta.password, totpSecret };
}

async function deriveLoginUrl(vendorKey: string): Promise<string> {
  const vendor = await findVendorByCanonicalKey(vendorKey);
  if (vendor?.portalLoginUrl) return vendor.portalLoginUrl;
  return `https://${vendorKey}.com/login`;
}

async function failureResult(
  vendorKey: string,
  recipeId: number | null,
  mode: "replay" | "record" | "replay_then_record",
  status: RunStatus,
  message: string,
  durationMs: number,
  llmCalls: number,
  llmCostCents: number,
  organizationId: string | null,
): Promise<RunResult> {
  await logRun({
    vendorKey,
    recipeId,
    mode,
    status,
    invoicesFound: 0,
    durationMs,
    errorMessage: message,
    llmCalls,
    llmCostCents,
    organizationId,
  });
  return {
    vendorKey,
    recipeId,
    mode,
    status,
    invoicesFound: 0,
    durationMs,
    errorMessage: message,
    llmCalls,
    llmCostCents,
    downloads: [],
  };
}
