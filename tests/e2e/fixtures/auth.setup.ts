/**
 * Globales Auth-Setup für E2E-Tests.
 *
 * Nutzt die Test-Login-Action (nur aktiv wenn ENABLE_TEST_LOGIN=true in der
 * Ziel-Umgebung). Speichert den Browser-Storage-State damit alle nachfolgenden
 * Tests ohne Re-Login starten.
 *
 * Voraussetzung in der Preview/Test-Umgebung:
 *   ENABLE_TEST_LOGIN=true
 *   NODE_ENV != production
 */

import { test as setup, expect } from "@playwright/test";
import path from "node:path";

const AUTH_FILE = path.join("tests/e2e/.auth/user.json");

setup("authentifizieren als Test-User", async ({ page }) => {
  // Login ausschließlich über den Route-Handler /api/test/login.
  // Bewusst NICHT über den /login-Button (Server-Action `loginAsTestUser`):
  // dort gehen die Supabase-Auth-Cookies verloren, weil Next.js die in der
  // Action gesetzten Set-Cookie-Header beim `redirect()` verwirft. Der
  // Route-Handler setzt die Cookies dagegen direkt auf die Response, und
  // `page.request` teilt sich den Cookie-Store mit dem Browser-Context.
  const response = await page.request.post("/api/test/login", {
    data: { email: "test@infetch.local" },
  });
  expect(
    response.status(),
    `Test-Login fehlgeschlagen (Status ${response.status()}). ` +
      `Läuft der Server mit ENABLE_TEST_LOGIN=true und NODE_ENV != production?`,
  ).toBeLessThan(400);

  // Authentifizierter Zustand: / rendert die App-Shell.
  await page.goto("/");
  await expect(page.getByTestId("app-main")).toBeVisible({ timeout: 15_000 });

  // Storage-State speichern damit alle Tests ohne Re-Login starten.
  await page.context().storageState({ path: AUTH_FILE });
});
