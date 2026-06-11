/**
 * Glitchtip Webhook Endpoint — empfängt Alert-Events und schreibt sie
 * in data/sentry-errors.jsonl (max. 50 Einträge, rollierende Liste).
 *
 * Glitchtip konfigurieren:
 *   Project → Alerts → Add Recipient → Webhook
 *   URL: https://app.infetch.de/api/sentry-webhook
 *
 * Glitchtip sendet Slack-kompatibles JSON:
 *   { alias, text, attachments: [{ title, title_link, color, fields }] }
 */

import crypto from "node:crypto";
import { existsSync, readFileSync, writeFileSync, renameSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { NextResponse } from "next/server";

export const runtime = "nodejs";

const ERROR_LOG = join(process.cwd(), "data", "sentry-errors.jsonl");
const MAX_ENTRIES = 50;
const MAX_BODY_BYTES = 64 * 1024; // Glitchtip-Alerts sind klein — Schutz gegen Disk-Fill/RAM-Abuse

// ── Types ─────────────────────────────────────────────────────────────────────

type GlitchtipField = { title: string; value: string; short: boolean };
type GlitchtipAttachment = {
  title?: string;
  title_link?: string;
  text?: string;
  color?: string;
  fields?: GlitchtipField[];
};
type GlitchtipPayload = {
  alias?: string;
  text?: string;
  attachments?: GlitchtipAttachment[];
};

type ErrorEntry = {
  receivedAt: string;
  title: string;
  permalink: string;
  level: string;
  project: string;
  culprit: string;
};

// ── Helpers ───────────────────────────────────────────────────────────────────

function colorToLevel(color?: string): string {
  if (!color) return "error";
  if (color === "warning") return "warning";
  if (color === "good") return "info";
  return "error"; // "danger" und alles andere
}

function fieldValue(fields: GlitchtipField[] | undefined, key: string): string {
  return fields?.find((f) => f.title.toLowerCase() === key)?.value ?? "";
}

// ── Rollierende JSONL-Datei ───────────────────────────────────────────────────

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

  let payload: GlitchtipPayload;
  try {
    payload = JSON.parse(rawBody) as GlitchtipPayload;
  } catch {
    return NextResponse.json({ error: "Ungültiges JSON." }, { status: 400 });
  }

  const attachment = payload.attachments?.[0];
  const fields = attachment?.fields;

  const entry: ErrorEntry = {
    receivedAt: new Date().toISOString(),
    title: attachment?.title ?? payload.text ?? "Unbekannter Fehler",
    permalink: attachment?.title_link ?? "",
    level: colorToLevel(attachment?.color),
    project: fieldValue(fields, "project"),
    culprit: fieldValue(fields, "culprit") || fieldValue(fields, "release") || "",
  };

  appendEntry(entry);

  return NextResponse.json({ ok: true });
}
