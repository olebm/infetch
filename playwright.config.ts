import { tmpdir } from "node:os";
import { join } from "node:path";
import { defineConfig, devices } from "@playwright/test";

// INFETCH-259: Der Portal-Replay-Test speichert heruntergeladene PDFs über
// appConfig.invoiceStoragePath. Vor dem Laden der App-Config auf ein tmp-Verzeichnis
// umlenken, damit der Test nicht ins Repo schreibt. Betrifft nur den Test-Runner-
// Prozess — die App-E2E laufen gegen einen separaten Next-Server.
process.env.INVOICE_STORAGE_PATH ??= join(tmpdir(), "infetch-e2e-portal-invoices");

// INFETCH-283: Der Recorder-E2E importiert den Agent-Graph, der beim Laden den DB-Client
// konstruiert (verlangt ein gültiges DATABASE_URL-Format). Die Tests injizieren Fakes und
// fragen die DB nie ab; postgres.js verbindet lazy → ein lokaler String genügt, damit der
// Import nicht wirft. Bewusst LOKAL (kein Prod-Host).
process.env.DATABASE_URL ??= "postgresql://postgres:postgres@127.0.0.1:54322/postgres";

const baseURL = process.env.PLAYWRIGHT_BASE_URL ?? "http://127.0.0.1:3456";

export default defineConfig({
  testDir: "./tests/e2e",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: [["list"], ["html", { outputFolder: "playwright-report", open: "never" }]],

  use: {
    baseURL,
    trace: "on-first-retry",
    screenshot: "only-on-failure",
    video: "retain-on-failure",
    locale: "de-DE",
  },

  projects: [
    // Globales Setup: Test-User einloggen, Storage-State speichern
    {
      name: "setup",
      testMatch: /.*\.setup\.ts/,
    },
    {
      name: "chromium",
      use: {
        ...devices["Desktop Chrome"],
        // Auth-State aus dem Setup-Projekt laden
        storageState: "tests/e2e/.auth/user.json",
      },
      dependencies: ["setup"],
      // Portal-Replay läuft eigenständig (eigener Fixture-Server, kein App-Login).
      testIgnore: /portal-.*\.test\.ts/,
    },
    {
      // INFETCH-259: Portal-Agent-Replay gegen lokale Fixture — kein App-Login,
      // kein laufender Next-Server, keine setup-Abhängigkeit.
      name: "portal-agent",
      testMatch: /portal-.*\.test\.ts/,
      use: { ...devices["Desktop Chrome"] },
    },
  ],

  // Kein webServer hier — E2E laufen gegen Preview-URL (CI) oder lokalen Dev-Server
});
