/**
 * Accessibility-Tests: WCAG 2.1 AA via axe-core für alle Hauptrouten.
 * Läuft nach Auth-Setup mit gespeichertem Storage-State.
 *
 * Bei Failures: Axe gibt [rule-id], Beschreibung und CSS-Selektoren aus.
 * Third-Party-Content (Supabase, PDF-Viewer): mit AxeBuilder.exclude() scopen,
 * nicht global disableRules() — nur gezielte Ausnahmen.
 */

import { expect, test } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

const WCAG_TAGS = ["wcag2a", "wcag2aa", "best-practice"] as const;

function formatViolations(violations: Awaited<ReturnType<AxeBuilder["analyze"]>>["violations"]) {
  if (violations.length === 0) return "";
  return violations
    .map(
      (v) =>
        `[${v.id}] ${v.description}\n  ${v.nodes.map((n) => n.target.join(", ")).join("\n  ")}`,
    )
    .join("\n");
}

test.describe("Accessibility-Audit WCAG 2.1 AA (axe)", () => {
  test("Dashboard / hat keine Verletzungen", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByTestId("app-main")).toBeVisible();
    await page.waitForLoadState("networkidle");
    const results = await new AxeBuilder({ page }).withTags([...WCAG_TAGS]).analyze();
    expect(results.violations, formatViolations(results.violations)).toHaveLength(0);
  });

  test("Posteingang /audit hat keine Verletzungen", async ({ page }) => {
    await page.goto("/audit");
    await expect(page.getByTestId("app-main")).toBeVisible();
    await page.waitForLoadState("networkidle");
    const results = await new AxeBuilder({ page }).withTags([...WCAG_TAGS]).analyze();
    expect(results.violations, formatViolations(results.violations)).toHaveLength(0);
  });

  test("Einstellungen /einstellungen hat keine Verletzungen", async ({ page }) => {
    await page.goto("/einstellungen");
    await expect(page.getByTestId("app-main")).toBeVisible();
    await page.waitForLoadState("networkidle");
    const results = await new AxeBuilder({ page }).withTags([...WCAG_TAGS]).analyze();
    expect(results.violations, formatViolations(results.violations)).toHaveLength(0);
  });

  test("/login (unauthenticated) hat keine Verletzungen", async ({ browser }) => {
    const ctx = await browser.newContext({ storageState: { cookies: [], origins: [] } });
    const page = await ctx.newPage();
    await page.goto("/login");
    await page.waitForLoadState("networkidle");
    const results = await new AxeBuilder({ page }).withTags([...WCAG_TAGS]).analyze();
    await ctx.close();
    expect(results.violations, formatViolations(results.violations)).toHaveLength(0);
  });
});
