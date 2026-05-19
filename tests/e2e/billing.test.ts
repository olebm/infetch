/**
 * E2E: Konto / Billing-Seite.
 * Testet Tier-Anzeige, Upgrade-Button (Free) und Profil-Formular.
 */

import { expect, test } from "@playwright/test";

test.describe("Konto-Seite", () => {
  test("Seite lädt mit Profil-Bereich", async ({ page }) => {
    await page.goto("/konto");
    await expect(page.getByTestId("app-main")).toBeVisible();
    await page.waitForLoadState("networkidle");

    await expect(page.getByText(/dein profil/i)).toBeVisible();
  });

  test("Abrechnung-Karte zeigt aktuellen Tier", async ({ page }) => {
    await page.goto("/konto");
    await expect(page.getByTestId("app-main")).toBeVisible();
    await page.waitForLoadState("networkidle");

    // BillingCard zeigt "Abrechnung" als Überschrift
    await expect(page.getByText("Abrechnung", { exact: true })).toBeVisible();

    // Tier-Badge vorhanden: "Free", "Pro" oder "Business"
    const tierBadge = page
      .getByText(/^Free$|^Pro$|^Business$/i)
      .or(page.getByText(/kostenlos|19 €|49 €/i));
    await expect(tierBadge.first()).toBeVisible();
  });

  test("Free-Tier zeigt Upgrade-Button (nur wenn Pro aktiv)", async ({ page }) => {
    await page.goto("/konto");
    await expect(page.getByTestId("app-main")).toBeVisible();
    await page.waitForLoadState("networkidle");

    const tierBadge = page.getByText(/^Free$/i).first();
    const isFree = await tierBadge.isVisible({ timeout: 3_000 }).catch(() => false);
    const proEnabled = process.env.NEXT_PUBLIC_PRO_ENABLED === "true";
    const upgradeBtn = page.getByRole("button", { name: /upgrade/i }).first();

    if (isFree && proEnabled) {
      // Free + Pro aktiv → Upgrade-Button muss sichtbar sein
      await expect(upgradeBtn).toBeVisible();
    } else if (isFree && !proEnabled) {
      // Free-only Launch (#8): Upgrade-Pfad bewusst ausgeblendet
      await expect(upgradeBtn).toBeHidden();
    } else {
      // Paid-Tier: "Abonnement verwalten" oder kein Upgrade-Button
      test.info().annotations.push({ type: "info", description: "Paid tier — Upgrade-Button nicht erwartet" });
    }
  });

  test("Profil-Formular enthält E-Mail-Feld", async ({ page }) => {
    await page.goto("/konto");
    await expect(page.getByTestId("app-main")).toBeVisible();
    await page.waitForLoadState("networkidle");

    const emailField = page.getByRole("textbox", { name: /e-mail/i }).first();
    await expect(emailField).toBeVisible();

    // E-Mail-Feld enthält die Test-User-Adresse
    const value = await emailField.inputValue();
    expect(value).toMatch(/@/);
  });

  test("Feature-Liste des aktuellen Plans ist sichtbar", async ({ page }) => {
    await page.goto("/konto");
    await expect(page.getByTestId("app-main")).toBeVisible();
    await page.waitForLoadState("networkidle");

    // Mindestens ein Feature-Listeneintrag (mit Häkchen-Icon) vorhanden
    const checkItems = page.locator("ul li").filter({ has: page.locator("svg") });
    await expect(checkItems.first()).toBeVisible();
  });

  test("Sicherheit-Bereich zeigt Magic-Link als aktiv", async ({ page }) => {
    await page.goto("/konto");
    await expect(page.getByTestId("app-main")).toBeVisible();
    await page.waitForLoadState("networkidle");

    await expect(page.getByText(/magic-link/i)).toBeVisible();
    await expect(page.getByText(/aktiv/i).first()).toBeVisible();
  });
});
