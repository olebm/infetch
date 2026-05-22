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

import { existsSync, readFileSync, writeFileSync, renameSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { NextResponse } from "next/server";

const ERROR_LOG = join(process.cwd(), "data", "sentry-errors.jsonl");
const MAX_ENTRIES = 50;

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
            try { return [JSON.parse(line) as ErrorEntry]; }
            catch { return []; }
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
