/**
 * Sentry Webhook Endpoint — empfängt neue Fehler-Events und schreibt sie
 * in data/sentry-errors.jsonl (max. 50 Einträge, rollierende Liste).
 *
 * Sentry konfigurieren:
 *   Settings → Integrations → Webhooks → Add Webhook
 *   URL: https://deine-domain.de/api/sentry-webhook
 *   Secret: SENTRY_WEBHOOK_SECRET (identisch in .env setzen)
 *   Events: issue (created + resolved)
 */

import { createHmac, timingSafeEqual } from "node:crypto";
import { existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { NextResponse } from "next/server";
import { appConfig } from "@/lib/config/env";

const ERROR_LOG = join(process.cwd(), "data", "sentry-errors.jsonl");
const MAX_ENTRIES = 50;

// ── Signatur-Verifikation ─────────────────────────────────────────────────────

function verifySignature(body: string, signature: string, secret: string): boolean {
  const expected = createHmac("sha256", secret).update(body).digest("hex");
  try {
    return timingSafeEqual(Buffer.from(signature), Buffer.from(expected));
  } catch {
    return false;
  }
}

// ── Rollierende JSONL-Datei ───────────────────────────────────────────────────

function appendError(entry: SentryErrorEntry) {
  try {
    mkdirSync(join(process.cwd(), "data"), { recursive: true });

    const existing: SentryErrorEntry[] = existsSync(ERROR_LOG)
      ? readFileSync(ERROR_LOG, "utf8")
          .split("\n")
          .filter(Boolean)
          .map((line) => JSON.parse(line) as SentryErrorEntry)
      : [];

    const updated = [...existing, entry].slice(-MAX_ENTRIES);
    writeFileSync(ERROR_LOG, updated.map((e) => JSON.stringify(e)).join("\n") + "\n", "utf8");
  } catch (err) {
    console.error("[sentry-webhook] Fehler beim Schreiben der Error-Log:", err);
  }
}

// ── Types ─────────────────────────────────────────────────────────────────────

type SentryErrorEntry = {
  receivedAt: string;
  action: string;
  level: string;
  title: string;
  culprit: string;
  permalink: string;
  firstSeen: string;
  lastSeen: string;
  count: number;
  issueId: string;
};

// ── Handler ───────────────────────────────────────────────────────────────────

export async function POST(request: Request) {
  const rawBody = await request.text();
  const signature = request.headers.get("sentry-hook-signature") ?? "";
  const secret = appConfig.sentry.webhookSecret;

  // Signatur prüfen (in production Pflicht, in dev optional)
  if (secret) {
    if (!signature || !verifySignature(rawBody, signature, secret)) {
      return NextResponse.json({ error: "Ungültige Signatur." }, { status: 401 });
    }
  } else if (process.env.NODE_ENV === "production") {
    // In production ohne Secret ablehnen
    return NextResponse.json({ error: "Webhook-Secret nicht konfiguriert." }, { status: 500 });
  }

  let payload: Record<string, unknown>;
  try {
    payload = JSON.parse(rawBody) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: "Ungültiges JSON." }, { status: 400 });
  }

  const action = String(payload.action ?? "unknown");
  const issue = (payload.data as Record<string, unknown>)?.issue as Record<string, unknown> | undefined;

  if (!issue) {
    // Kein Issue-Event (z. B. ping) — einfach bestätigen
    return NextResponse.json({ ok: true });
  }

  const entry: SentryErrorEntry = {
    receivedAt: new Date().toISOString(),
    action,
    level: String(issue.level ?? "error"),
    title: String(issue.title ?? "Unbekannter Fehler"),
    culprit: String(issue.culprit ?? ""),
    permalink: String(issue.permalink ?? ""),
    firstSeen: String(issue.firstSeen ?? ""),
    lastSeen: String(issue.lastSeen ?? ""),
    count: Number(issue.count ?? 1),
    issueId: String(issue.id ?? ""),
  };

  appendError(entry);

  return NextResponse.json({ ok: true });
}
