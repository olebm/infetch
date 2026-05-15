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
  // Test-Login über den speziellen Dev-Endpunkt
  await page.goto("/login");

  // Prüfen ob Test-Login verfügbar ist (Button existiert bei ENABLE_TEST_LOGIN=true)
  const testLoginBtn = page.getByTestId("test-login-btn");
  const hasTestLogin = await testLoginBtn.isVisible({ timeout: 3_000 }).catch(() => false);

  if (hasTestLogin) {
    await testLoginBtn.click();
  } else {
    // Fallback: manuell über die API-Action einloggen
    const response = await page.request.post("/api/test/login", {
      data: { email: "test@infetch.local" },
    });
    expect(response.status()).toBeLessThan(400);
    await page.goto("/");
  }

  // Warten bis die App-Shell geladen ist (authentifizierter Zustand)
  await expect(page.getByTestId("app-main")).toBeVisible({ timeout: 10_000 });

  // Storage-State speichern
  await page.context().storageState({ path: AUTH_FILE });
});
