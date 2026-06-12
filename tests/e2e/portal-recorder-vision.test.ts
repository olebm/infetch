/**
 * INFETCH-283 — Vision-Fallback des Recipe-Recorders.
 *
 * Prüft den browser-gebundenen Vision-Pfad: wenn der (Text-)Agent `needs_vision`
 * signalisiert, macht der Recorder einen maskierten Screenshot und lässt Pixtral
 * entscheiden. Die LLM-Grenzen sind injiziert (Fake-Agents) — kein echter Mistral-
 * Call, deterministisch und kostenfrei. Die Masking-Funktion läuft echt.
 *
 * Eigenes `portal-agent`-Playwright-Projekt (kein App-Login).
 */

import { expect, test } from "@playwright/test";
import { recordRecipe } from "@/portals/agent/recipe-recorder";
import type { AgentCallResult } from "@/portals/agent/mistral-agent";
import type { AgentCredentials } from "@/portals/agent/types";

const CREDS: AgentCredentials = { username: "kunde@example.com", password: "s3cret" };

// Fixture mit vorbefülltem Eingabefeld (für den Masking-Check) + einem Button.
const FIXTURE_HTML = `<!doctype html><html lang="de"><body>
  <h1>Portal</h1>
  <input id="email" type="email" value="kunde@example.com" aria-label="E-Mail" />
  <button type="button">Rechnungen</button>
</body></html>`;
const LOGIN_URL = `data:text/html;charset=utf-8,${encodeURIComponent(FIXTURE_HTML)}`;

function reply(decision: AgentCallResult["decision"], modelUsed = "fake"): AgentCallResult {
  // Realistische Token-Zahlen, damit die Kostenrundung (ganze Cent) > 0 ergibt.
  return {
    decision,
    rawReply: "",
    usage: { inputTokens: 100_000, outputTokens: 20_000 },
    modelUsed,
  };
}

const needsVision = reply({
  reasoning: "DOM mehrdeutig",
  action: { type: "needs_vision", reason: "ambig" },
});

test.describe("Recipe-Recorder Vision-Fallback (INFETCH-283)", () => {
  test("needs_vision → Pixtral entscheidet → gültiges Recipe; Screenshot maskiert", async ({
    page,
  }) => {
    let visionCalls = 0;
    let sawScreenshot = false;

    const recorded = await recordRecipe(
      { page, vendorKey: "fake", loginUrl: LOGIN_URL, credentials: CREDS },
      {
        readApiKey: async () => "test-key",
        callAgent: async () => needsVision, // Text-Agent kann sich nicht festlegen
        callAgentWithVision: async (input) => {
          visionCalls += 1;
          sawScreenshot =
            typeof input.screenshotBase64 === "string" && input.screenshotBase64.length > 0;
          return reply(
            { reasoning: "Rechnungen sichtbar", action: { type: "done", reason: "ok" } },
            "pixtral-12b-latest",
          );
        },
        // captureMaskedScreenshot NICHT überschrieben → echte Masking-Funktion läuft.
      },
    );

    expect(recorded.ok, recorded.errorMessage ?? "").toBe(true);
    expect(recorded.recipe).not.toBeNull();
    expect(visionCalls).toBe(1);
    expect(sawScreenshot).toBe(true);
    // AC3: Vision-Kosten (Pixtral) gezählt — 1 Text- + 1 Vision-Call.
    expect(recorded.llmCalls).toBe(2);
    expect(recorded.llmCostCents).toBeGreaterThan(0);
    // AC2: die echte Masking-Funktion hat das Eingabefeld VOR dem Screenshot überschrieben.
    expect(await page.locator("#email").inputValue()).toBe("[redacted]");
  });

  test("Fail-closed: schlägt Masking/Screenshot fehl, kein Vision-Versand", async ({ page }) => {
    let visionCalled = false;

    const recorded = await recordRecipe(
      { page, vendorKey: "fake", loginUrl: LOGIN_URL, credentials: CREDS },
      {
        readApiKey: async () => "test-key",
        callAgent: async () => needsVision,
        callAgentWithVision: async () => {
          visionCalled = true;
          return reply({ reasoning: "x", action: { type: "done", reason: "ok" } });
        },
        captureMaskedScreenshot: async () => {
          throw new Error("Masking kaputt");
        },
      },
    );

    expect(recorded.ok).toBe(false);
    expect(visionCalled).toBe(false);
    expect(recorded.errorMessage).toMatch(/Masking|fehlgeschlagen/i);
  });

  test("Vision bleibt unentschlossen (needs_vision) → sauberer Fehler statt Crash", async ({
    page,
  }) => {
    const recorded = await recordRecipe(
      { page, vendorKey: "fake", loginUrl: LOGIN_URL, credentials: CREDS },
      {
        readApiKey: async () => "test-key",
        callAgent: async () => needsVision,
        callAgentWithVision: async () =>
          reply(
            { reasoning: "auch unklar", action: { type: "needs_vision", reason: "still ambig" } },
            "pixtral-12b-latest",
          ),
      },
    );

    expect(recorded.ok).toBe(false);
    expect(recorded.recipe).toBeNull();
    expect(recorded.errorMessage).toMatch(/visuell nicht eindeutig|manuelle Hilfe/i);
  });
});
