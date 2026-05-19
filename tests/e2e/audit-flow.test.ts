/**
 * E2E: Audit / Review-Flow.
 * Testet Struktur und Navigation im Posteingang sowie den Detail-Review-Screen,
 * wenn eine Rechnung existiert. Verwendet Upload als Setup-Schritt wenn nötig.
 */

import path from "node:path";
import { expect, test } from "@playwright/test";

const TEST_PDF_PATH = path.join("tests/e2e/fixtures/minimal.pdf");

test.describe("Audit-Posteingang", () => {
  test("/audit zeigt Posteingang-Struktur", async ({ page }) => {
    await page.goto("/audit");
    await expect(page.getByTestId("app-main")).toBeVisible();

    // Immer vorhanden, unabhängig von Feature-Flags
    await expect(page.getByRole("heading", { name: "Posteingang" })).toBeVisible();

    // Upload-Panel nur wenn manueller Upload aktiv (Free-only Launch #8 blendet aus)
    if (process.env.NEXT_PUBLIC_MANUAL_UPLOAD_ENABLED === "true") {
      await expect(page.getByRole("button", { name: /PDF manuell hochladen/i })).toBeVisible();
    }
  });

  test("Suche ist bedienbar", async ({ page }) => {
    await page.goto("/audit");
    await expect(page.getByTestId("app-main")).toBeVisible();

    const searchInput = page.getByRole("searchbox").or(page.getByPlaceholder(/suchen|search/i)).first();
    if (await searchInput.isVisible()) {
      await searchInput.fill("test");
      await expect(searchInput).toHaveValue("test");
      await searchInput.clear();
    }
  });
});

test.describe("Rechnungs-Detailseite", () => {
  test("Existierende Rechnung öffnet Detail-View oder Seite zeigt Upload-Hinweis", async ({
    page,
  }) => {
    await page.goto("/audit");
    await page.waitForLoadState("networkidle");

    const manualUpload = process.env.NEXT_PUBLIC_MANUAL_UPLOAD_ENABLED === "true";

    if (manualUpload) {
      // Eine Rechnung über Upload erstellen, damit ein Eintrag existiert
      await page.getByRole("button", { name: /PDF manuell hochladen/i }).click();
      await expect(page.locator("#invoicePdf")).toBeVisible({ timeout: 10_000 });
      await page.locator("#invoicePdf").setInputFiles(TEST_PDF_PATH);
      await page.getByRole("button", { name: /^Importieren$/i }).click();

      // Auf Import-Abschluss warten — Status sichtbar ODER Seite navigiert nach revalidatePath
      const statusLocator = page.locator(".bg-ok-soft, .bg-violet-50, .bg-danger-soft");
      await statusLocator.waitFor({ state: "visible", timeout: 15_000 }).catch(async () => {
        await page.waitForLoadState("networkidle", { timeout: 5_000 }).catch(() => {});
      });

      await page.reload();
      await page.waitForLoadState("networkidle");
    }

    // Ersten Link zu einer Rechnung in der Liste finden
    const invoiceLink = page.locator('a[href*="/audit/"]').first();
    const hasInvoice = await invoiceLink.isVisible({ timeout: 5_000 }).catch(() => false);

    if (!hasInvoice) {
      // Kein Eintrag (z. B. Free-only Launch ohne manuellen Upload) →
      // Posteingang muss trotzdem strukturell rendern (Empty-State-Hinweis).
      await expect(page.getByRole("heading", { name: "Posteingang" })).toBeVisible();
      return;
    }

    await invoiceLink.click();
    await page.waitForLoadState("networkidle");

    // Detail-View geladen — URL enthält Invoice-ID
    await expect(page).toHaveURL(/\/audit\/\d+/);

    // Grundlegende UI-Elemente vorhanden
    await expect(page.getByTestId("app-main")).toBeVisible();

    // Zurück-Link existiert
    const backLink = page
      .getByRole("link", { name: /zurück|posteingang|audit/i })
      .or(page.locator('a[href="/audit"]'));
    await expect(backLink.first()).toBeVisible();
  });

  test("Review-Formular enthält Kernfelder wenn Rechnung geöffnet", async ({ page }) => {
    await page.goto("/audit");

    const invoiceLink = page.locator('a[href*="/audit/"]').first();
    const hasInvoice = await invoiceLink.isVisible({ timeout: 3_000 }).catch(() => false);

    if (!hasInvoice) {
      test.skip();
      return;
    }

    await invoiceLink.click();
    await page.waitForLoadState("networkidle");
    await expect(page).toHaveURL(/\/audit\/\d+/);

    // Review-Formular hat mindestens Datum- und Betragsfeld
    const dateField = page
      .getByLabel(/datum|date/i)
      .or(page.locator('input[name*="date"], input[name*="datum"]'))
      .first();
    const amountField = page
      .getByLabel(/betrag|amount/i)
      .or(page.locator('input[name*="amount"], input[name*="betrag"]'))
      .first();

    // Mindestens eines der Felder muss sichtbar sein
    const hasDate = await dateField.isVisible({ timeout: 3_000 }).catch(() => false);
    const hasAmount = await amountField.isVisible({ timeout: 3_000 }).catch(() => false);
    expect(hasDate || hasAmount).toBe(true);
  });
});
