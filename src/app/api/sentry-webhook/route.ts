/**
 * Glitchtip Webhook Endpoint — empfängt Alert-Events und schreibt sie
 * in data/sentry-errors.jsonl (max. 50 Einträge, rollierende Liste).
 *
 * Glitchtip konfigurieren:
 *   Project → Alerts → Add Recipient → Webhook
 *   URL: https://app.infetch.de/api/sentry-webhook
 *
 * Kein Signature-Secret erforderlich (Glitchtip signiert Webhooks nicht).
 */

import { existsSync, readFileSync, writeFileSync, renameSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { NextResponse } from "next/server";

const ERROR_LOG = join(process.cwd(), "data", "sentry-errors.jsonl");
const MAX_ENTRIES = 50;

// ── Rollierende JSONL-Datei ───────────────────────────────────────────────────

type ErrorEntry = {
  receivedAt: string;
  raw: unknown;
};

function appendEntry(entry: ErrorEntry) {
  try {
    mkdirSync(join(process.cwd(), "data"), { recursive: true });

    const existing: ErrorEntry[] = existsSync(ERROR_LOG)
      ? readFileSync(ERROR_LOG, "utf8")
          .split("\n")
          .filter(Boolean)
          .flatMap((line) => {
            try {
              return [JSON.parse(line) as ErrorEntry];
            } catch {
              return [];
            }
          })
      : [];

    const updated = [...existing, entry].slice(-MAX_ENTRIES);
    const tmp = `${ERROR_LOG}.${process.pid}.tmp`;
    writeFileSync(tmp, updated.map((e) => JSON.stringify(e)).join("\n") + "\n", "utf8");
    renameSync(tmp, ERROR_LOG);
  } catch (err) {
    console.error("[glitchtip-webhook] Fehler beim Schreiben:", err);
  }
}

// ── Handler ───────────────────────────────────────────────────────────────────

export async function POST(request: Request) {
  const rawBody = await request.text();

  let payload: unknown;
  try {
    payload = JSON.parse(rawBody);
  } catch {
    payload = rawBody;
  }

  appendEntry({ receivedAt: new Date().toISOString(), raw: payload });

  console.log("[glitchtip-webhook] Event empfangen:", JSON.stringify(payload, null, 2));

  return NextResponse.json({ ok: true });
}
