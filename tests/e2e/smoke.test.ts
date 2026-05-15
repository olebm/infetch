/**
 * Smoke-Tests: Grundlegende Seitenladetests für alle Hauptrouten.
 * Laufen nach Auth-Setup mit gespeichertem Storage-State.
 */

import { expect, test } from "@playwright/test";

test.describe("Auth-Schutz", () => {
  test("nicht-authentifizierter Zugriff auf / leitet auf /login weiter", async ({ browser }) => {
    // Explizit leerer Storage-State — kein Cookie-Erbe aus dem Projekt-Fixture
    const context = await browser.newContext({ storageState: { cookies: [], origins: [] } });
    const page = await context.newPage();
    await page.goto("/");
    await page.waitForURL(/\/login/, { timeout: 10_000 });
    await expect(page).toHaveURL(/\/login/);
    await context.close();
  });

  test("/login lädt und zeigt Magic-Link-Formular", async ({ browser }) => {
    const context = await browser.newContext({ storageState: { cookies: [], origins: [] } });
    const page = await context.newPage();
    await page.goto("/login");
    await page.waitForLoadState("networkidle");
    await expect(page.getByText(/Magic-Link/).first()).toBeVisible();
    await expect(page.getByRole("textbox", { name: /E-Mail/i })).toBeVisible();
    await context.close();
  });
});

test.describe("Dashboard und Hauptnavigation", () => {
  test("Dashboard / lädt ohne Fehler", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByTestId("app-main")).toBeVisible();
    // Kein unbehandelter Fehler in der Konsole
    const errors: string[] = [];
    page.on("pageerror", (err) => errors.push(err.message));
    await page.waitForLoadState("networkidle");
    expect(errors).toHaveLength(0);
  });

  test("/audit (Posteingang) lädt", async ({ page }) => {
    await page.goto("/audit");
    await expect(page.getByTestId("app-main")).toBeVisible();
    await page.waitForLoadState("networkidle");
  });

  test("/einstellungen lädt", async ({ page }) => {
    await page.goto("/einstellungen");
    await expect(page.getByTestId("app-main")).toBeVisible();
    await page.waitForLoadState("networkidle");
  });

  test("/konto lädt", async ({ page }) => {
    await page.goto("/konto");
    await expect(page.getByTestId("app-main")).toBeVisible();
    await page.waitForLoadState("networkidle");
  });

  test("/senders lädt", async ({ page }) => {
    await page.goto("/senders");
    await expect(page.getByTestId("app-main")).toBeVisible();
    await page.waitForLoadState("networkidle");
  });
});

test.describe("Redirects", () => {
  test("/exports leitet weiter", async ({ page }) => {
    await page.goto("/exports");
    // Redirect zu /audit?tab=versendet oder ähnlich
    await expect(page).toHaveURL(/audit/);
  });

  test("/invoices leitet auf /audit weiter", async ({ page }) => {
    await page.goto("/invoices");
    await expect(page).toHaveURL(/\/audit/);
  });

  test("/inbox leitet auf /audit weiter", async ({ page }) => {
    await page.goto("/inbox");
    await expect(page).toHaveURL(/\/audit/);
  });
});

test.describe("Footer", () => {
  test("Footer ist sichtbar und enthält Copyright", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByText(/© 2026 Infetch/)).toBeVisible();
  });
});
