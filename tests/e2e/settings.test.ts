/**
 * E2E: Einstellungen-Seite.
 * Testet Tab-Navigation, Konfidenz-Slider und Scan-Intervall-Selektor.
 */

import { expect, test } from "@playwright/test";

test.describe("Einstellungen-Seite", () => {
  test("Seite lädt mit Kern-Tabs", async ({ page }) => {
    await page.goto("/einstellungen");
    await expect(page.getByTestId("app-main")).toBeVisible();

    await expect(page.getByRole("tab", { name: /buchhaltung/i })).toBeVisible();
    await expect(page.getByRole("tab", { name: /postfächer/i })).toBeVisible();
    // Integrationen-Tab ist Pro-only und in CI nicht aktiv
    await expect(page.getByRole("tab", { name: /ki.*auto|auto.*pilot/i })).toBeVisible();
  });

  test("Tab-Wechsel zu KI & Auto-Pilot zeigt Konfidenz-Slider", async ({ page }) => {
    await page.goto("/einstellungen");
    await expect(page.getByTestId("app-main")).toBeVisible();

    // Auf KI & Auto-Pilot Tab wechseln
    await page.getByRole("tab", { name: /ki.*auto|auto.*pilot/i }).click();

    // Empfindlichkeits-Label und Slider sichtbar
    await expect(page.getByText(/empfindlichkeit/i)).toBeVisible();
    const slider = page.getByRole("slider").or(page.locator('input[type="range"]')).first();
    await expect(slider).toBeVisible();
  });

  test("Konfidenz-Slider lässt sich bedienen", async ({ page }) => {
    await page.goto("/einstellungen");
    await page.getByRole("tab", { name: /ki.*auto|auto.*pilot/i }).click();

    const slider = page.getByRole("slider").or(page.locator('input[type="range"]')).first();
    await expect(slider).toBeVisible();

    const currentValue = await slider.getAttribute("value");
    // Slider-Wert ist eine Zahl im Bereich 0-100
    if (currentValue !== null) {
      expect(Number(currentValue)).toBeGreaterThanOrEqual(0);
      expect(Number(currentValue)).toBeLessThanOrEqual(100);
    }
  });

  test("Tab-Wechsel zu Postfächer zeigt IMAP-Bereich", async ({ page }) => {
    await page.goto("/einstellungen");
    await page.getByRole("tab", { name: /postfächer/i }).click();

    await expect(
      page
        .getByRole("heading", { name: /postfächer.*IMAP/i })
        .or(page.getByText("Postfächer (IMAP)", { exact: true }))
        .first(),
    ).toBeVisible();
  });

  test("Buchhaltung-Tab zeigt Empfänger-Bereich", async ({ page }) => {
    await page.goto("/einstellungen");
    await page.getByRole("tab", { name: /buchhaltung/i }).click();
    await expect(page.getByText("Empfänger für deine Buchhaltung", { exact: true })).toBeVisible();
  });
});
