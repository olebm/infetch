/**
 * INFETCH-281 — Pagination der Rechnungslisten im Replay.
 *
 * Fake-Portal mit 3 Seiten (insgesamt 5 Rechnungen, newest-first). Prüft:
 *  - playRecipe blättert über alle Seiten (paginationSelector),
 *  - der since-Filter bricht früh ab (Folgeseiten werden nicht mehr geladen),
 *  - maxPages deckelt die Seitenzahl.
 *
 * Eigenes `portal-agent`-Playwright-Projekt (kein App-Login).
 */

import http from "node:http";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { expect, test } from "@playwright/test";
import { playRecipe } from "@/portals/agent/recipe-player";
import type { AgentCredentials, Recipe } from "@/portals/agent/types";

const CREDS: AgentCredentials = { username: "kunde@example.com", password: "s3cret" };
const PDF = readFileSync(join(__dirname, "fixtures", "minimal.pdf"));

// 3 Seiten, absteigend datiert (deutsches Datumsformat → normalizeDate-Pfad).
const PAGES = [
  [
    { date: "15.05.2026", file: "INV-2026-05.pdf" },
    { date: "10.04.2026", file: "INV-2026-04.pdf" },
  ],
  [
    { date: "01.03.2026", file: "INV-2026-03.pdf" },
    { date: "15.02.2026", file: "INV-2026-02.pdf" },
  ],
  [{ date: "10.01.2026", file: "INV-2026-01.pdf" }],
];

function listHtml(pageIndex: number): string {
  const rows = (PAGES[pageIndex] ?? [])
    .map(
      (inv) =>
        `<tr class="invoice-row"><td class="invoice-date">${inv.date}</td>` +
        `<td><a class="download" href="/download/${inv.file}">PDF</a></td></tr>`,
    )
    .join("");
  const next =
    pageIndex + 1 < PAGES.length
      ? `<a class="next" href="/rechnungen?page=${pageIndex + 2}">Weiter</a>`
      : "";
  return `<!doctype html><html lang="de"><body><h1>Rechnungen</h1>
    <table class="invoices"><tbody>${rows}</tbody></table>${next}</body></html>`;
}

type Fixture = {
  server: http.Server;
  baseUrl: string;
  page3Requests: () => number;
};

function startFixture(): Promise<Fixture> {
  let page3 = 0;
  const server = http.createServer((req, res) => {
    const url = new URL(req.url ?? "/", "http://127.0.0.1");
    if (req.method === "GET" && url.pathname === "/rechnungen") {
      const pageNum = Number(url.searchParams.get("page") ?? "1");
      if (pageNum === 3) page3 += 1;
      res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
      res.end(listHtml(Math.max(0, pageNum - 1)));
      return;
    }
    if (req.method === "GET" && url.pathname.startsWith("/download/")) {
      res.writeHead(200, {
        "content-type": "application/pdf",
        "content-disposition": `attachment; filename="${url.pathname.slice("/download/".length)}"`,
      });
      res.end(PDF);
      return;
    }
    res.writeHead(404);
    res.end("not found");
  });
  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => {
      const addr = server.address();
      const port = typeof addr === "object" && addr ? addr.port : 0;
      resolve({ server, baseUrl: `http://127.0.0.1:${port}`, page3Requests: () => page3 });
    });
  });
}

function makeRecipe(baseUrl: string, maxPages?: number): Recipe {
  return {
    vendorKey: "fake-paginated",
    loginUrl: `${baseUrl}/rechnungen`,
    loginFlow: [{ type: "goto", url: `${baseUrl}/rechnungen` }],
    navigationFlow: [{ type: "waitFor", selector: ".invoice-row" }],
    invoiceList: {
      rowSelector: ".invoice-row",
      dateSelector: ".invoice-date",
      downloadSelector: "a.download",
      paginationSelector: "a.next",
      maxPages,
    },
  };
}

let fixture: Fixture;

test.describe("Portal-Pagination (INFETCH-281)", () => {
  test.beforeAll(async () => {
    fixture = await startFixture();
  });
  test.afterAll(async () => {
    await new Promise<void>((r) => fixture.server.close(() => r()));
  });

  test("blättert über alle Seiten und lädt jede Rechnung", async ({ page }) => {
    const result = await playRecipe(page, makeRecipe(fixture.baseUrl), CREDS, {
      allowedVendorUrl: fixture.baseUrl,
    });

    expect(result.status, result.message ?? "").toBe("success");
    expect(result.downloads).toHaveLength(5);
    expect(fixture.page3Requests()).toBeGreaterThanOrEqual(1);
  });

  test("since-Filter bricht ab, sobald nur noch ältere Rechnungen kommen", async ({ page }) => {
    const before = fixture.page3Requests();
    const result = await playRecipe(page, makeRecipe(fixture.baseUrl), CREDS, {
      allowedVendorUrl: fixture.baseUrl,
      since: "2026-04-01",
    });

    expect(result.status, result.message ?? "").toBe("success");
    // Seite 1 (15.05., 10.04.) ≥ since; Seite 2 enthält nur Ältere → Stopp vor Seite 3.
    expect(result.downloads).toHaveLength(2);
    expect(fixture.page3Requests()).toBe(before); // Seite 3 wurde nicht angefordert
  });

  test("maxPages deckelt die Seitenzahl", async ({ page }) => {
    const result = await playRecipe(page, makeRecipe(fixture.baseUrl, 1), CREDS, {
      allowedVendorUrl: fixture.baseUrl,
    });

    expect(result.status, result.message ?? "").toBe("success");
    expect(result.downloads).toHaveLength(2); // nur Seite 1
  });
});
