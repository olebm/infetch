/**
 * Sentry PII-Scrubber — läuft vor jedem Event-Upload (beforeSend).
 *
 * Infetch verarbeitet Rechnungsdaten: E-Mails, Beträge, IBANs.
 * Diese dürfen Sentry niemals erreichen — weder in Stack-Frames noch
 * in Request-Bodies oder Breadcrumbs.
 *
 * Strategie:
 *   1. User-Kontext löschen
 *   2. Request-Body + Headers bereinigen
 *   3. Stack-Frame-Variablen per Regex scrubben
 *   4. Breadcrumbs entfernen
 */

import type { ErrorEvent, EventHint } from "@sentry/nextjs";

// ── PII-Muster ────────────────────────────────────────────────────────────────

const PII_PATTERNS: Array<[RegExp, string]> = [
  // E-Mail-Adressen
  [/[a-z0-9._%+\-]+@[a-z0-9.\-]+\.[a-z]{2,}/gi, "[email]"],
  // IBAN (DE + andere)
  [/[A-Z]{2}\d{2}[A-Z0-9 ]{8,30}/g, "[iban]"],
  // Beträge mit Währungssymbol (€ 1.234,56 oder 1234.56 €)
  [/€\s*[\d.,]+|[\d.,]+\s*€/g, "[amount]"],
  // Deutsche Telefonnummern
  [/(\+49|0049|0)[0-9 .\-/]{7,20}/g, "[phone]"],
];

// ── Hilfsfunktionen ───────────────────────────────────────────────────────────

function scrubString(value: string): string {
  let out = value;
  for (const [pattern, replacement] of PII_PATTERNS) {
    out = out.replace(pattern, replacement);
  }
  return out;
}

function scrubValue(value: unknown, depth = 0): unknown {
  if (depth > 6) return "[truncated]";
  if (typeof value === "string") return scrubString(value);
  if (Array.isArray(value)) return value.map((v) => scrubValue(v, depth + 1));
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([k, v]) => [
        k,
        scrubValue(v, depth + 1),
      ]),
    );
  }
  return value;
}

// ── Haupt-Scrubber ────────────────────────────────────────────────────────────

// eslint-disable-next-line @typescript-eslint/no-unused-vars
export function scrubSentryEvent(event: ErrorEvent, _hint: EventHint): ErrorEvent | null {
  // 1) User-Kontext — nie senden
  delete event.user;

  // 2) Request bereinigen
  if (event.request) {
    // POST-Body: enthält ggf. formData mit Passwörtern / Rechnungsdaten
    delete event.request.data;

    // Query-String scrubben (z. B. ?email=foo@bar.de)
    if (typeof event.request.query_string === "string") {
      event.request.query_string = scrubString(event.request.query_string);
    } else if (event.request.query_string) {
      event.request.query_string = "";
    }

    // URL: nur Origin + Pfad behalten, Query entfernen
    if (event.request.url) {
      try {
        const u = new URL(event.request.url);
        event.request.url = `${u.origin}${u.pathname}`;
      } catch {
        // keep as-is wenn URL nicht parsebar
      }
    }

    // Headers: nur harmlose Felder behalten
    if (event.request.headers) {
      const SAFE = new Set(["content-type", "accept", "user-agent"]);
      event.request.headers = Object.fromEntries(
        Object.entries(event.request.headers).filter(([k]) => SAFE.has(k.toLowerCase())),
      );
    }
  }

  // 3) Breadcrumbs entfernen — enthalten besuchte URLs, Console-Logs
  if (event.breadcrumbs) {
    event.breadcrumbs = [];
  }

  // 4) Stack-Frame-Variablen scrubben
  if (event.exception?.values) {
    for (const exc of event.exception.values) {
      if (exc.value) exc.value = scrubString(exc.value);
      if (exc.stacktrace?.frames) {
        for (const frame of exc.stacktrace.frames) {
          if (frame.vars) {
            frame.vars = scrubValue(frame.vars) as Record<string, unknown>;
          }
        }
      }
    }
  }

  // 5) Extra + Contexts scrubben
  if (event.extra) {
    event.extra = scrubValue(event.extra) as Record<string, unknown>;
  }

  return event;
}
