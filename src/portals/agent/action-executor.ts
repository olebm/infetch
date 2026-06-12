/**
 * Action-Executor: setzt eine AgentAction in einen Playwright-Aufruf um.
 *
 * Der Locator wird aus dem LocatorHint deterministisch abgeleitet (Role + Name).
 * Playwright's getByRole findet Elemente robust auch wenn sich CSS-Klassen aendern.
 * Wir behalten zusaetzlich den abgeleiteten Selektor, um ihn in der Recipe zu speichern.
 */

import type { Page } from "playwright";
import type { AgentAction } from "@/portals/agent/mistral-agent";
import type { LocatorHint } from "@/portals/agent/tree-serializer";
import type { AgentCredentials, RecipeStep } from "@/portals/agent/types";

export type ExecutedStep = {
  step: RecipeStep | null;
  finished: boolean;
  needsVision: boolean;
  reason?: string;
};

const STEP_TIMEOUT_MS = 12_000;

export async function executeAction(
  page: Page,
  action: AgentAction,
  locator: LocatorHint | null,
  credentials: AgentCredentials,
): Promise<ExecutedStep> {
  switch (action.type) {
    case "done":
      return { step: null, finished: true, needsVision: false, reason: action.reason };

    case "needs_vision":
      return { step: null, finished: false, needsVision: true, reason: action.reason };

    case "wait": {
      await page
        .waitForLoadState("domcontentloaded", { timeout: action.timeoutMs ?? 5_000 })
        .catch(() => {});
      return { step: null, finished: false, needsVision: false };
    }

    case "press": {
      await page.keyboard.press(action.key);
      const step: RecipeStep = { type: "press", key: action.key };
      return { step, finished: false, needsVision: false };
    }

    case "click": {
      if (!locator)
        return { step: null, finished: false, needsVision: false, reason: "locator missing" };
      const playwrightLocator = page
        .getByRole(locator.role as never, { name: locator.name })
        .first();
      await playwrightLocator.click({ timeout: STEP_TIMEOUT_MS });
      const selector = deriveSelector(locator);
      const step: RecipeStep = { type: "click", selector };
      return { step, finished: false, needsVision: false };
    }

    case "fill": {
      if (!locator)
        return { step: null, finished: false, needsVision: false, reason: "locator missing" };
      const value = await resolveCredentialValue(action.value, credentials);
      const playwrightLocator = page
        .getByRole(locator.role as never, { name: locator.name })
        .first();
      await playwrightLocator.fill(value, { timeout: STEP_TIMEOUT_MS });
      const selector = deriveSelector(locator);
      const valueFrom = classifyValueSource(action.value);
      const step: RecipeStep = { type: "fill", selector, valueFrom };
      return { step, finished: false, needsVision: false };
    }
  }
}

function deriveSelector(locator: LocatorHint): string {
  // Playwright role+name CSS-Pseudo: 'role=button[name="Anmelden"]'
  const namePart = locator.name ? `[name="${escapeName(locator.name)}"]` : "";
  return `role=${locator.role}${namePart}`;
}

function escapeName(value: string): string {
  return value.replace(/"/g, '\\"');
}

async function resolveCredentialValue(
  value: string,
  credentials: AgentCredentials,
): Promise<string> {
  if (value === "credential.username") return credentials.username;
  if (value === "credential.password") return credentials.password;
  if (value === "totp") {
    if (!credentials.totpSecret) throw new Error("TOTP-Secret fehlt fuer diesen Schritt.");
    // Lazy-Import: otplib zieht @scure/base (pure ESM) — als Top-Level-Import bräche
    // das jeden CJS-Consumer (u. a. den Playwright-Recorder-E2E). Nur im TOTP-Pfad laden.
    const { generate } = await import("otplib");
    return generate({ secret: credentials.totpSecret });
  }
  // Literal-Wert (z.B. ein Suchbegriff)
  return value;
}

function classifyValueSource(
  value: string,
): "credential.username" | "credential.password" | "totp" {
  if (value === "credential.password") return "credential.password";
  if (value === "totp") return "totp";
  return "credential.username"; // Default — fuer literale Werte gehen wir vom Username aus
}
