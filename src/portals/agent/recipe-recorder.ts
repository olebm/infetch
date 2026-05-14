/**
 * Recipe-Recorder: nimmt einen Browser-Lauf auf und produziert eine wiederabspielbare Recipe.
 *
 * Ablauf:
 *   1. Loop mit max MAX_STEPS Iterationen
 *   2. Pro Iteration: Accessibility-Tree snapshotten + an Mistral schicken
 *   3. Mistral antwortet mit next_action (Function-Call)
 *   4. Action ausfuehren, Step protokollieren
 *   5. Bei "done" oder Rechnungs-Liste sichtbar: Loop beenden
 *   6. Aus den geloggten Steps eine Recipe synthetisieren (Login-Flow / Navigation / Invoice-List)
 *
 * Falls Mistral-API-Key fehlt: klarer Fehler, kein Versuch.
 */

import type { Page } from "playwright";
import { callAgent, calculateCostCents, type AgentMessage } from "@/portals/agent/mistral-agent";
import { snapshotTree } from "@/portals/agent/tree-serializer";
import { executeAction } from "@/portals/agent/action-executor";
import { readCredentialSecret } from "@/lib/secrets/credential-store";
import type { AgentCredentials, Recipe, RecipeStep } from "@/portals/agent/types";

export type RecordResult = {
  ok: boolean;
  recipe: Recipe | null;
  llmCalls: number;
  llmCostCents: number;
  errorMessage: string | null;
};

const MAX_STEPS = 20;
const MAX_AMBIGUITY_RETRIES = 2;

export async function recordRecipe(input: {
  page: Page;
  vendorKey: string;
  loginUrl: string;
  credentials: AgentCredentials;
}): Promise<RecordResult> {
  const apiKey = await readCredentialSecret({ scope: "mistral" });
  if (!apiKey) {
    return {
      ok: false,
      recipe: null,
      llmCalls: 0,
      llmCostCents: 0,
      errorMessage:
        "Kein KI-Schluessel hinterlegt. Trag unter Einstellungen einen Mistral-Schluessel ein, damit wir neue Portale automatisch lernen koennen.",
    };
  }

  const steps: RecipeStep[] = [];
  const conversation: AgentMessage[] = [];
  let llmCalls = 0;
  let llmCostCents = 0;
  let ambiguityRetries = 0;

  // Erster Step: zur Login-URL navigieren (deterministisch, ohne LLM)
  try {
    await input.page.goto(input.loginUrl, { timeout: 30_000, waitUntil: "domcontentloaded" });
    steps.push({ type: "goto", url: input.loginUrl });
  } catch (error) {
    return {
      ok: false,
      recipe: null,
      llmCalls,
      llmCostCents,
      errorMessage: `Login-Seite konnte nicht geladen werden: ${describeError(error)}`,
    };
  }

  const hasTotp = Boolean(input.credentials.totpSecret);
  const goal = [
    `Log in to ${input.vendorKey} and navigate to the invoice list page.`,
    "Stop when invoices are visible.",
    hasTotp
      ? "Falls das Portal einen 2FA-Code abfragt: fill the code field with valueFrom 'totp'."
      : "Falls das Portal einen 2FA-Code abfragt, signal done — wir haben keinen TOTP-Schlüssel hinterlegt.",
  ].join(" ");

  for (let i = 0; i < MAX_STEPS; i++) {
    const { tree, locatorById } = await snapshotTree(input.page);
    const treeJson = JSON.stringify(tree, null, 2);

    let result;
    try {
      result = await callAgent({
        messages: conversation,
        treeJson,
        goal,
        escalate: ambiguityRetries > 0,
      });
    } catch (error) {
      return {
        ok: false,
        recipe: null,
        llmCalls,
        llmCostCents,
        errorMessage: `Agent-Aufruf fehlgeschlagen: ${describeError(error)}`,
      };
    }

    llmCalls += 1;
    llmCostCents += calculateCostCents(result.usage, result.modelUsed);

    if (!result.decision) {
      if (ambiguityRetries < MAX_AMBIGUITY_RETRIES) {
        ambiguityRetries += 1;
        conversation.push({
          role: "user",
          content: "Bitte erneut entscheiden — wähle eine konkrete next_action.",
        });
        continue;
      }
      return {
        ok: false,
        recipe: null,
        llmCalls,
        llmCostCents,
        errorMessage: "KI konnte sich auf keine Aktion festlegen.",
      };
    }

    const locator = result.decision.action.type === "click" || result.decision.action.type === "fill"
      ? locatorById.get((result.decision.action as { elementId: string }).elementId) ?? null
      : null;

    try {
      const executed = await executeAction(
        input.page,
        result.decision.action,
        locator,
        input.credentials,
      );

      conversation.push({
        role: "assistant",
        content: `${result.decision.reasoning} — Action: ${JSON.stringify(result.decision.action)}`,
      });

      if (executed.step) steps.push(executed.step);

      if (executed.needsVision) {
        // Vision-Fallback nicht in MVP — wir markieren als ambiguity-retry
        if (ambiguityRetries < MAX_AMBIGUITY_RETRIES) {
          ambiguityRetries += 1;
          conversation.push({
            role: "user",
            content: "Vision noch nicht verfuegbar. Versuche eine DOM-basierte Aktion stattdessen.",
          });
          continue;
        }
        return {
          ok: false,
          recipe: null,
          llmCalls,
          llmCostCents,
          errorMessage: "Portal-UI ist im DOM nicht eindeutig — manuelle Hilfe nötig.",
        };
      }

      if (executed.finished) {
        const recipe = synthesizeRecipe({
          vendorKey: input.vendorKey,
          loginUrl: input.loginUrl,
          steps,
        });
        return { ok: true, recipe, llmCalls, llmCostCents, errorMessage: null };
      }
    } catch (error) {
      return {
        ok: false,
        recipe: null,
        llmCalls,
        llmCostCents,
        errorMessage: `Aktion fehlgeschlagen: ${describeError(error)}`,
      };
    }
  }

  return {
    ok: false,
    recipe: null,
    llmCalls,
    llmCostCents,
    errorMessage: `Maximum von ${MAX_STEPS} Schritten erreicht ohne Rechnungen zu finden.`,
  };
}

/**
 * Synthese: trenne Login-Flow, Navigation und leite Invoice-List-Selectoren ab.
 * Heuristik:
 *   - Login-Flow endet beim ersten click-Step, dessen selector "submit" oder "anmeld" enthaelt,
 *     oder spaetestens nach dem ersten Fill-Password-Step + Click.
 *   - Alles danach gehoert zur Navigation.
 *   - Invoice-List-Selectoren werden als Defaults vorgegeben — der Player matched flexibel.
 */
export function synthesizeRecipe(input: {
  vendorKey: string;
  loginUrl: string;
  steps: RecipeStep[];
}): Recipe {
  const steps = input.steps;
  let loginEnd = steps.findIndex(
    (s, idx) =>
      idx > 0 &&
      s.type === "click" &&
      "selector" in s &&
      /submit|anmeld|sign[ -]?in|login/i.test(s.selector),
  );
  if (loginEnd === -1) {
    // Fallback: nach erstem Password-Fill + 1
    const pwIdx = steps.findIndex((s) => s.type === "fill" && "valueFrom" in s && s.valueFrom === "credential.password");
    loginEnd = pwIdx >= 0 ? Math.min(pwIdx + 1, steps.length - 1) : Math.min(steps.length - 1, 3);
  }

  const loginFlow = steps.slice(0, loginEnd + 1);
  const navigationFlow = steps.slice(loginEnd + 1);

  return {
    vendorKey: input.vendorKey,
    loginUrl: input.loginUrl,
    loginFlow,
    navigationFlow,
    invoiceList: {
      rowSelector: "[data-testid*='invoice'], tr.invoice-row, ul.invoice-list > li, [role='row']",
      dateSelector: "[data-testid*='date'], time, .date, [aria-label*='Datum'], [aria-label*='Date']",
      downloadSelector: "a[download], a[href*='.pdf'], button[aria-label*='herunter'], button[aria-label*='download']",
    },
    successHeuristic: "url contains invoice|rechnung|abrechnung",
  };
}

function describeError(error: unknown): string {
  if (error instanceof Error) {
    return error.message.split("\n")[0].slice(0, 200);
  }
  return String(error).slice(0, 200);
}
