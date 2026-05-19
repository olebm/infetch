/**
 * Generischer Crawler: prüft breitflächig, dass Routen, interne Links und
 * Buttons funktionieren — ohne Fachlogik (dafür: die Flow-Specs).
 *
 *  1. Route-Crawler:  jede öffentliche + App-Route → kein 4xx/5xx,
 *     keine Next.js-Error-Boundary, keine unbehandelten Page-Errors.
 *  2. Link-Crawler:   alle internen <a href> auf den Seed-Seiten besuchen
 *     und auf denselben Gesundheitszustand prüfen.
 *  3. Button-Audit:   jeder sichtbare Button hat einen zugänglichen Namen
 *     (fängt kaputte/unbeschriftete Buttons). Klicks bleiben den Flow-Specs
 *     vorbehalten (destruktive Aktionen nicht blind auslösen).
 */

import { expect, test, type Page } from "@playwright/test";

const PUBLIC_ROUTES = [
  "/login",
  "/landingpage",
  "/onboarding",
  "/onboarding/erstabruf",
  "/agb",
  "/datenschutz",
  "/impressum",
  "/avv",
  "/changelog",
  "/ueber-uns",
  "/blog",
];

// Authentifizierte App-Routen (Storage-State aus dem Setup-Projekt).
// /online-accounts ist bewusst NICHT enthalten: die Seite ruft notFound()
// wenn ENABLE_PORTALS aus ist (Prod-Default — Portal-Agent zurückgestellt).
const APP_ROUTES = [
  "/",
  "/audit",
  "/einstellungen",
  "/konto",
  "/fehlt",
  "/senders",
];

const ERROR_BOUNDARY = /Application error|Internal Server Error|Unhandled Runtime Error|This page could not be found|client-side exception/i;

/** Navigiert zu route und prüft den Grundgesundheitszustand der Seite. */
async function assertHealthy(page: Page, route: string): Promise<void> {
  const pageErrors: string[] = [];
  page.on("pageerror", (e) => pageErrors.push(e.message));

  const resp = await page.goto(route, { waitUntil: "domcontentloaded" });
  expect(resp, `Keine Response für ${route}`).toBeTruthy();
  expect(
    resp!.status(),
    `${route} → HTTP ${resp!.status()} (final URL ${page.url()})`,
  ).toBeLessThan(400);

  await page.waitForLoadState("networkidle").catch(() => {});

  const bodyText = (await page.locator("body").innerText().catch(() => "")) ?? "";
  expect(
    ERROR_BOUNDARY.test(bodyText),
    `${route} zeigt eine Error-Boundary/Fehlerseite`,
  ).toBe(false);

  expect(
    pageErrors,
    `${route} hat unbehandelte Page-Errors:\n${pageErrors.join("\n")}`,
  ).toHaveLength(0);
}

test.describe("Route-Crawler — öffentliche Seiten", () => {
  test.use({ storageState: { cookies: [], origins: [] } });

  for (const route of PUBLIC_ROUTES) {
    test(`öffentlich: ${route} lädt fehlerfrei`, async ({ page }) => {
      await assertHealthy(page, route);
    });
  }
});

test.describe("Route-Crawler — App-Seiten (authentifiziert)", () => {
  for (const route of APP_ROUTES) {
    test(`app: ${route} lädt fehlerfrei`, async ({ page }) => {
      await assertHealthy(page, route);
      // Geschützte Routen rendern die App-Shell (oder leiten gültig um,
      // z. B. /exports → /audit — dann ist app-main ebenfalls vorhanden).
      await expect(page.getByTestId("app-main")).toBeVisible();
    });
  }
});

test.describe("Link-Crawler — interne Links der Seed-Seiten", () => {
  // Seeds decken App- und öffentliche Bereiche ab.
  const SEED_PAGES = ["/", "/audit", "/konto", "/einstellungen", "/login", "/changelog"];

  test("alle eindeutigen internen Links sind erreichbar", async ({ page }) => {
    // Ein Test besucht viele Seiten sequenziell; unter Turbopack-On-Demand-
    // Compile reicht das Default-Timeout (30s) nicht. Großzügig setzen.
    test.setTimeout(180_000);
    const toVisit = new Set<string>();

    for (const seed of SEED_PAGES) {
      await page.goto(seed, { waitUntil: "domcontentloaded", timeout: 30_000 });
      const hrefs = await page.locator("a[href]").evaluateAll((els) =>
        els.map((e) => (e as HTMLAnchorElement).getAttribute("href") ?? ""),
      );
      for (const href of hrefs) {
        if (!href || href.startsWith("#")) continue;
        if (/^(mailto:|tel:|javascript:)/i.test(href)) continue;
        // Nur interne Pfade
        let pathname: string;
        try {
          pathname = href.startsWith("/")
            ? href
            : new URL(href, page.url()).origin === new URL(page.url()).origin
              ? new URL(href, page.url()).pathname + new URL(href, page.url()).search
              : "";
        } catch {
          continue;
        }
        if (!pathname || !pathname.startsWith("/")) continue;
        // Ausschluss: Logout (zerstört Session), API, Datei-Downloads.
        if (/^\/(logout|api)\b/.test(pathname)) continue;
        if (/\.(pdf|zip|csv|png|jpg|svg|ico)$/i.test(pathname)) continue;
        toVisit.add(pathname);
      }
    }

    const failures: string[] = [];
    for (const path of toVisit) {
      const resp = await page
        .goto(path, { waitUntil: "domcontentloaded", timeout: 30_000 })
        .catch(() => null);
      if (!resp) {
        failures.push(`${path} → keine Response`);
        continue;
      }
      if (resp.status() >= 400) {
        failures.push(`${path} → HTTP ${resp.status()}`);
        continue;
      }
      const bodyText = (await page.locator("body").innerText().catch(() => "")) ?? "";
      if (ERROR_BOUNDARY.test(bodyText)) {
        failures.push(`${path} → Error-Boundary`);
      }
    }

    expect(
      failures,
      `Defekte interne Links:\n${failures.join("\n")}\n(geprüft: ${toVisit.size})`,
    ).toHaveLength(0);
  });
});

test.describe("Button-Audit — zugängliche Namen", () => {
  const PAGES = ["/", "/audit", "/konto", "/einstellungen", "/senders"];

  for (const route of PAGES) {
    test(`Buttons auf ${route} haben zugängliche Namen`, async ({ page }) => {
      await page.goto(route, { waitUntil: "domcontentloaded" });
      await page.waitForLoadState("networkidle").catch(() => {});

      const unlabeled = await page
        .locator("button:visible")
        .evaluateAll((btns) =>
          btns
            .map((b, i) => {
              const name =
                (b.getAttribute("aria-label") ??
                  b.getAttribute("title") ??
                  b.textContent ??
                  "").trim();
              return name.length === 0 ? `Button #${i} (${b.outerHTML.slice(0, 80)})` : null;
            })
            .filter((x): x is string => x !== null),
        );

      expect(
        unlabeled,
        `${route}: Buttons ohne zugänglichen Namen:\n${unlabeled.join("\n")}`,
      ).toHaveLength(0);
    });
  }
});
