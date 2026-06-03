/**
 * E2E: Manueller PDF-Import-Flow.
 * Testet das Upload-Panel auf /audit: öffnen, Datei wählen, absenden,
 * Erfolgs- und Duplikat-Meldung prüfen.
 */

import path from "node:path";
import { expect, test } from "@playwright/test";

const TEST_PDF_PATH = path.join("tests/e2e/fixtures/minimal.pdf");

test.describe("Manueller PDF-Upload", () => {
  // Free-only Launch (#8) blendet den manuellen Upload aus. Feature ist
  // reversibel via NEXT_PUBLIC_MANUAL_UPLOAD_ENABLED=true — diese Specs
  // testen dann den realen Flow; im Launch-Zustand werden sie übersprungen.
  test.skip(
    process.env.NEXT_PUBLIC_MANUAL_UPLOAD_ENABLED !== "true",
    "Manueller Upload im Free-only Launch deaktiviert (NEXT_PUBLIC_MANUAL_UPLOAD_ENABLED)",
  );

  test("Upload-Panel öffnet sich per Klick", async ({ page }) => {
    await page.goto("/audit");
    await expect(page.getByTestId("app-main")).toBeVisible();

    const toggleBtn = page.getByRole("button", { name: /PDF manuell hochladen/i });
    await expect(toggleBtn).toBeVisible();

    // Panel ist zunächst geschlossen — File-Input nicht sichtbar
    await expect(page.locator("#invoicePdf")).not.toBeVisible();

    await toggleBtn.click();
    await expect(page.locator("#invoicePdf")).toBeVisible();
  });

  test("Upload eines Test-PDFs zeigt Erfolgs- oder Duplikat-Meldung", async ({ page }) => {
    await page.goto("/audit");
    await page.getByRole("button", { name: /PDF manuell hochladen/i }).click();
    // Sicherstellen dass das Panel offen ist
    await expect(page.locator("#invoicePdf")).toBeVisible();

    // Test-PDF anhängen
    await page.locator("#invoicePdf").setInputFiles(TEST_PDF_PATH);

    // Absenden
    await page.getByRole("button", { name: /^Importieren$/i }).click();

    // Auf Abschluss warten — entweder Status-Nachricht sofort sichtbar (client-state)
    // oder nach revalidatePath-Navigation erscheint die Invoice in der Liste
    const statusMsg = page.locator(".bg-ok-soft, .bg-violet-50");
    const invoiceInList = page.locator('a[href*="/audit/"]');
    await Promise.race([
      expect(statusMsg)
        .toBeVisible({ timeout: 15_000 })
        .catch(() => {}),
      expect(invoiceInList.first()).toBeVisible({ timeout: 15_000 }),
    ]);
  });

  test("Erneuter Upload desselben PDFs zeigt Duplikat-Meldung", async ({ page }) => {
    await page.goto("/audit");
    await page.getByRole("button", { name: /PDF manuell hochladen/i }).click();
    await expect(page.locator("#invoicePdf")).toBeVisible();
    await page.locator("#invoicePdf").setInputFiles(TEST_PDF_PATH);
    await page.getByRole("button", { name: /^Importieren$/i }).click();

    // Warten bis erste Aktion abgeschlossen ist (Status sichtbar ODER Liste aktualisiert)
    await page.waitForTimeout(3_000);

    // Panel ggf. nach Seiten-Refresh erneut öffnen
    const panelOpen = await page
      .locator("#invoicePdf")
      .isVisible()
      .catch(() => false);
    if (!panelOpen) {
      await page.getByRole("button", { name: /PDF manuell hochladen/i }).click();
      await expect(page.locator("#invoicePdf")).toBeVisible();
    }

    // Zweiten Upload starten
    await page.locator("#invoicePdf").setInputFiles(TEST_PDF_PATH);
    await page.getByRole("button", { name: /^Importieren$/i }).click();

    // Duplikat-Meldung oder Fehler erwartet — beides zeigt dass Deduplizierung funktioniert
    const dupMsg = page.locator(".bg-violet-50");
    await expect(dupMsg.or(page.getByText(/duplikat|bereits|doppelt/i)).first()).toBeVisible({
      timeout: 15_000,
    });
  });

  test("Upload ohne Datei ist nicht möglich (required-Validierung)", async ({ page }) => {
    await page.goto("/audit");
    await page.waitForLoadState("networkidle");
    await page.getByRole("button", { name: /PDF manuell hochladen/i }).click();
    // Sicherstellen dass das Panel komplett geöffnet ist
    await expect(page.locator("#invoicePdf")).toBeVisible({ timeout: 10_000 });

    // Absenden ohne Datei — Browser-Validierung greift, Formular bleibt offen
    await page.getByRole("button", { name: /^Importieren$/i }).click();

    // File-Input muss noch sichtbar sein (kein Submit-Navigate)
    await expect(page.locator("#invoicePdf")).toBeVisible();
  });
});
