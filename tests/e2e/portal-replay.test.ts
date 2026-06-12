/**
 * INFETCH-259 — erster echter Replay-E2E des Portal-Agents.
 *
 * Fährt playRecipe() mit einer echten Browser-Page gegen eine lokale Fake-Portal-
 * Fixture (Mini-HTTP-Server): Login-Form (E-Mail + Passwort) → Rechnungsliste →
 * PDF-Downloads. Deckt den browser-gebundenen Pfad ab, den die Node-Unit-Tests
 * (INFETCH-151) bewusst nicht abbilden können (kein Chromium im vitest-Job).
 *
 * Eigenes Playwright-Projekt `portal-agent` (siehe playwright.config.ts): kein
 * App-Login-Setup, kein laufender Next-Server nötig — nur der Fixture-Server hier.
 */

import http from "node:http";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { expect, test } from "@playwright/test";
import { playRecipe } from "@/portals/agent/recipe-player";
import type { AgentCredentials, Recipe } from "@/portals/agent/types";

const CREDS: AgentCredentials = { username: "kunde@example.com", password: "s3cret-portal" };
const PDF = readFileSync(join(__dirname, "fixtures", "minimal.pdf"));

// 3 Rechnungen, deutsches Datumsformat (testet zugleich den normalizeDate-Pfad).
const INVOICES = [
  { date: "15.05.2026", file: "INV-2026-05.pdf" },
  { date: "10.04.2026", file: "INV-2026-04.pdf" },
  { date: "01.03.2026", file: "INV-2026-03.pdf" },
];

const LOGIN_HTML = `<!doctype html><html lang="de"><body><h1>Anmeldung</h1>
  <form method="POST" action="/">
    <input id="email" name="email" type="email" autocomplete="username" />
    <input id="password" name="password" type="password" autocomplete="current-password" />
    <button id="submit" type="submit">Anmelden</button>
  </form></body></html>`;

function invoiceListHtml(): string {
  const rows = INVOICES.map(
    (inv) =>
      `<tr class="invoice-row"><td class="invoice-date">${inv.date}</td>` +
      `<td><a class="download" href="/download/${inv.file}">Download</a></td></tr>`,
  ).join("");
  return `<!doctype html><html lang="de"><body><h1>Ihre Rechnungen</h1>
    <table class="invoices"><tbody>${rows}</tbody></table></body></html>`;
}

function html(res: http.ServerResponse, body: string): void {
  res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
  res.end(body);
}

/** Fake-Portal: Login-Wall, Session-Cookie, Rechnungsliste, PDF-Download. */
function startFixture(): Promise<{ server: http.Server; baseUrl: string }> {
  const server = http.createServer((req, res) => {
    const url = new URL(req.url ?? "/", "http://127.0.0.1");
    const isAuthed = (req.headers.cookie ?? "").includes("session=ok");

    if (req.method === "GET" && url.pathname === "/") return html(res, LOGIN_HTML);

    if (req.method === "POST" && url.pathname === "/") {
      let body = "";
      req.on("data", (c) => (body += c));
      req.on("end", () => {
        const p = new URLSearchParams(body);
        const ok = p.get("email") === CREDS.username && p.get("password") === CREDS.password;
        if (ok) {
          res.writeHead(303, { location: "/rechnungen", "set-cookie": "session=ok; Path=/" });
          res.end();
        } else {
          html(res, LOGIN_HTML); // falsche Creds → zurück zur Login-Wall
        }
      });
      return;
    }

    if (req.method === "GET" && url.pathname === "/rechnungen") {
      return html(res, isAuthed ? invoiceListHtml() : LOGIN_HTML);
    }

    if (req.method === "GET" && url.pathname.startsWith("/download/")) {
      const name = url.pathname.slice("/download/".length);
      res.writeHead(200, {
        "content-type": "application/pdf",
        "content-disposition": `attachment; filename="${name}"`,
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
      resolve({ server, baseUrl: `http://127.0.0.1:${port}` });
    });
  });
}

function makeRecipe(baseUrl: string): Recipe {
  return {
    vendorKey: "fake-portal",
    loginUrl: `${baseUrl}/`,
    loginFlow: [
      { type: "goto", url: `${baseUrl}/` },
      { type: "fill", selector: "#email", valueFrom: "credential.username" },
      { type: "fill", selector: "#password", valueFrom: "credential.password" },
      { type: "click", selector: "#submit" },
      { type: "waitForUrl", pattern: "**/rechnungen" },
    ],
    navigationFlow: [{ type: "waitFor", selector: ".invoice-row" }],
    invoiceList: {
      rowSelector: ".invoice-row",
      dateSelector: ".invoice-date",
      downloadSelector: "a.download",
    },
  };
}

let server: http.Server;
let baseUrl: string;

test.describe("Portal-Replay gegen Fake-Portal-Fixture (INFETCH-259)", () => {
  test.beforeAll(async () => {
    // Downloads landen in appConfig.invoiceStoragePath — in playwright.config.ts
    // vor dem env.ts-Laden auf ein tmp-Verzeichnis umgelenkt (kein Repo-Schreibzugriff).
    ({ server, baseUrl } = await startFixture());
  });

  test.afterAll(async () => {
    await new Promise<void>((r) => server.close(() => r()));
  });

  test("happy path: lädt alle Rechnungen, Status success", async ({ page }) => {
    const result = await playRecipe(page, makeRecipe(baseUrl), CREDS, {
      allowedVendorUrl: baseUrl,
    });

    expect(result.status, result.message ?? "").toBe("success");
    expect(result.ok).toBe(true);
    expect(result.downloads).toHaveLength(3);
    for (const d of result.downloads) {
      expect(existsSync(d.filePath), `Datei nicht gespeichert: ${d.filePath}`).toBe(true);
    }
  });

  test("targetYearMonth filtert ältere Rows weg", async ({ page }) => {
    const result = await playRecipe(page, makeRecipe(baseUrl), CREDS, {
      allowedVendorUrl: baseUrl,
      targetYearMonth: "2026-05",
    });

    expect(result.status, result.message ?? "").toBe("success");
    expect(result.downloads).toHaveLength(1);
    expect(result.downloads[0].originalFilename).toBe("INV-2026-05.pdf");
    expect(result.downloads[0].invoiceDate).toBe("2026-05-15");
  });

  test("since-Filter (INFETCH-52) überspringt bereits geholte Rows", async ({ page }) => {
    const result = await playRecipe(page, makeRecipe(baseUrl), CREDS, {
      allowedVendorUrl: baseUrl,
      since: "2026-04-01",
    });

    expect(result.status, result.message ?? "").toBe("success");
    // 15.05. und 10.04. liegen ≥ 2026-04-01; 01.03. fällt raus.
    expect(result.downloads).toHaveLength(2);
  });

  test("Egress-Schutz: fremde allowedVendorUrl blockiert den Lauf", async ({ page }) => {
    const result = await playRecipe(page, makeRecipe(baseUrl), CREDS, {
      allowedVendorUrl: "https://evil.example.com/",
    });

    expect(result.ok).toBe(false);
    expect(result.status).toBe("failed");
    expect(result.downloads).toHaveLength(0);
  });
});
