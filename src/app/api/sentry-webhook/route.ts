/**
 * Glitchtip Webhook Endpoint — empfängt Alert-Events und schreibt sie
 * in data/sentry-errors.jsonl (max. 50 Einträge, rollierende Liste).
 *
 * Glitchtip konfigurieren:
 *   Project → Alerts → Add Recipient → Webhook
 *   URL: https://app.infetch.de/api/sentry-webhook?token=<SENTRY_WEBHOOK_SECRET>
 *
 * Das Payload-Format hängt vom gewählten Recipient-Typ ab (General/Slack,
 * MS Teams, Discord, Google Chat) — das Mapping übernimmt parseAlertPayload.
 * Unbekannte Formate werden mit einem Roh-Sample geloggt, damit ein
 * Format-Mismatch diagnostizierbar bleibt (INFETCH-285: neun kontextlose
 * "Unbekannter Fehler"-Einträge ohne jede Spur zur Ursache).
 */

import crypto from "node:crypto";
import { existsSync, readFileSync, writeFileSync, renameSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { NextResponse } from "next/server";
import { parseAlertPayload } from "@/lib/sentry/parse-alert";

export const runtime = "nodejs";

const MAX_ENTRIES = 50;
const MAX_BODY_BYTES = 64 * 1024; // Glitchtip-Alerts sind klein — Schutz gegen Disk-Fill/RAM-Abuse
const MAX_RAW_SAMPLE_CHARS = 2048; // reicht zur Format-Diagnose, hält die Datei klein

type ErrorEntry = {
  receivedAt: string;
  title: string;
  permalink: string;
  level: string;
  project: string;
  culprit: string;
  format: string;
  /** Nur bei format "unknown": gekürzte Roh-Payload zur Diagnose. */
  raw?: string;
};

// ── Rollierende JSONL-Datei ───────────────────────────────────────────────────

// Zur Request-Zeit aufgelöst, damit Tests den Pfad per Env umleiten können —
// Testläufe dürfen nie die echte Datei beschreiben (genau so entstanden die
// neun Phantom-Einträge des Incidents vom 2026-06-11).
function errorLogPath(): string {
  return (
    process.env.SENTRY_ERRORS_FILE?.trim() || join(process.cwd(), "data", "sentry-errors.jsonl")
  );
}

function appendEntry(entry: ErrorEntry) {
  try {
    const logPath = errorLogPath();
    mkdirSync(dirname(logPath), { recursive: true });

    const existing: ErrorEntry[] = existsSync(logPath)
      ? readFileSync(logPath, "utf8")
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
    const tmp = `${logPath}.${process.pid}.tmp`;
    writeFileSync(tmp, updated.map((e) => JSON.stringify(e)).join("\n") + "\n", "utf8");
    renameSync(tmp, logPath);
  } catch (err) {
    console.error("[glitchtip-webhook] Fehler beim Schreiben:", err);
  }
}

// ── Handler ───────────────────────────────────────────────────────────────────

export async function POST(request: Request) {
  // SECURITY (INFETCH-274): Shared-Secret prüfen. Glitchtip ruft eine feste URL
  // auf → Secret als Query-Param (?token=...), timing-safe verglichen. Ohne
  // konfiguriertes Secret nur in lokaler Entwicklung offen (wie die Cron-Routen).
  const secret = process.env.SENTRY_WEBHOOK_SECRET?.trim();
  if (!secret) {
    if ((process.env.NODE_ENV as string) !== "development") {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
  } else {
    const provided = new URL(request.url).searchParams.get("token") ?? "";
    const provHash = crypto.createHash("sha256").update(provided).digest();
    const expHash = crypto.createHash("sha256").update(secret).digest();
    if (!crypto.timingSafeEqual(provHash, expHash)) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
  }

  const rawBody = await request.text();
  // SECURITY (INFETCH-274): Größenlimit vor dem Parsen/Schreiben (unauth-naher Pfad).
  if (Buffer.byteLength(rawBody, "utf8") > MAX_BODY_BYTES) {
    return NextResponse.json({ error: "Payload zu groß." }, { status: 413 });
  }

  let payload: unknown;
  try {
    payload = JSON.parse(rawBody);
  } catch {
    return NextResponse.json({ error: "Ungültiges JSON." }, { status: 400 });
  }

  const parsed = parseAlertPayload(payload);
  const entry: ErrorEntry = parsed
    ? { receivedAt: new Date().toISOString(), ...parsed }
    : {
        receivedAt: new Date().toISOString(),
        title: "Unbekannter Fehler",
        permalink: "",
        level: "error",
        project: "",
        culprit: "",
        format: "unknown",
        raw: rawBody.slice(0, MAX_RAW_SAMPLE_CHARS),
      };

  appendEntry(entry);

  return NextResponse.json({ ok: true });
}
