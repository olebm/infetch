/**
 * Glitchtip-Alert-Parser — mappt eingehende Webhook-Payloads auf ein
 * einheitliches ErrorEntry-Format für data/sentry-errors.jsonl.
 *
 * Glitchtip kennt mehrere Webhook-Recipient-Typen, die jeweils ein eigenes
 * JSON-Format senden (Quelle: glitchtip-backend, apps/alerts/webhooks.py):
 *
 *   - General Webhook (Slack-kompatibel):
 *       { text, attachments: [{ title, title_link, text: <culprit>, color: <hex>, fields }] }
 *   - Microsoft Teams (Adaptive Card):
 *       { type: "message", attachments: [{ contentType: "...card.adaptive",
 *         content: { body: [TextBlock…, FactSet], actions: [Action.OpenUrl] } }] }
 *   - Discord: { content, embeds: [{ title, url, description, color: <int>, fields }] }
 *   - Google Chat: { cardsV2: [{ card: { header, sections: [{ header, widgets }] } }] }
 *
 * Dazu das Sentry-Legacy-Format (WebHooks-Plugin): { project, culprit, level, url, message }.
 *
 * Welcher Typ in der Glitchtip-UI konfiguriert ist, können wir serverseitig
 * nicht erzwingen — deshalb erkennt der Parser alle Formate. Liefert er null,
 * ist die Payload unbekannt und der Aufrufer muss ein Roh-Sample mitloggen,
 * sonst ist das Fehlerbild nicht diagnostizierbar (INFETCH-285: neun
 * kontextlose "Unbekannter Fehler"-Einträge).
 */

// ── Typen ─────────────────────────────────────────────────────────────────────

export type ParsedAlert = {
  title: string;
  permalink: string;
  level: string;
  project: string;
  culprit: string;
  /** Erkanntes Quellformat — macht Fehlkonfiguration in Glitchtip sichtbar. */
  format: string;
};

// ── Narrowing-Helfer (Payload ist extern, keinem Schema trauen) ───────────────

function str(v: unknown): string {
  return typeof v === "string" ? v : "";
}

function arr(v: unknown): unknown[] {
  return Array.isArray(v) ? v : [];
}

function obj(v: unknown): Record<string, unknown> {
  return v !== null && typeof v === "object" && !Array.isArray(v)
    ? (v as Record<string, unknown>)
    : {};
}

// ── Level-Mapping ─────────────────────────────────────────────────────────────

// Glitchtip sendet die Farbe als Hex (issue.get_hex_color()), ältere Versionen
// als Slack-Namen. Discord bekommt denselben Hex-Wert als Integer.
const LEVEL_BY_COLOR: Record<string, string> = {
  danger: "error",
  "#e52b50": "error",
  warning: "warning",
  "#e9b949": "warning",
  good: "info",
  "#4b60b4": "info",
};

function colorToLevel(color: unknown): string {
  if (typeof color === "number") {
    return LEVEL_BY_COLOR[`#${color.toString(16).padStart(6, "0")}`] ?? "error";
  }
  return LEVEL_BY_COLOR[str(color).toLowerCase()] ?? "error";
}

// ── Format-Parser (je null, wenn die Payload nicht zum Format passt) ──────────

function parseGeneralWebhook(payload: Record<string, unknown>): ParsedAlert | null {
  const attachment = obj(arr(payload.attachments)[0]);
  const title = str(attachment.title) || str(payload.text);
  if (!title) return null;

  const fields = arr(attachment.fields).map(obj);
  const fieldValue = (key: string) =>
    str(fields.find((f) => str(f.title).toLowerCase() === key)?.value);

  return {
    format: "glitchtip-webhook",
    title,
    permalink: str(attachment.title_link),
    level: colorToLevel(attachment.color),
    project: fieldValue("project"),
    // Glitchtip legt den Culprit in attachment.text ab, nicht in den fields.
    culprit: str(attachment.text) || fieldValue("culprit"),
  };
}

function parseTeamsWebhook(payload: Record<string, unknown>): ParsedAlert | null {
  const content = obj(obj(arr(payload.attachments)[0]).content);
  if (str(content.type) !== "AdaptiveCard") return null;

  const body = arr(content.body).map(obj);
  const textBlocks = body.filter((b) => str(b.type) === "TextBlock");
  // Karten-Aufbau: [Header "GlitchTip Alert", Issue-Titel (color: Attention), Culprit?, FactSet]
  const attentionIdx = textBlocks.findIndex((b) => str(b.color) === "Attention");
  const titleIdx = attentionIdx >= 0 ? attentionIdx : 0;
  const titleBlock = textBlocks[titleIdx];
  if (!titleBlock) return null;

  // Der Culprit-Block ist der nächste TextBlock ohne Hervorhebung — ein weiterer
  // hervorgehobener Block wäre bereits der Titel des nächsten Issues im Alert.
  const next = textBlocks[titleIdx + 1];
  const culprit =
    next && str(next.color) !== "Attention" && str(next.weight) !== "Bolder" ? str(next.text) : "";

  const facts = arr(body.find((b) => str(b.type) === "FactSet")?.facts).map(obj);
  const action = arr(content.actions)
    .map(obj)
    .find((a) => str(a.type) === "Action.OpenUrl");

  return {
    format: "glitchtip-msteams",
    title: str(titleBlock.text),
    permalink: str(obj(action).url),
    // Die Adaptive Card transportiert kein Level (color ist fix "Attention").
    level: "error",
    project: str(facts.find((f) => str(f.title).toLowerCase() === "project")?.value),
    culprit,
  };
}

function parseDiscordWebhook(payload: Record<string, unknown>): ParsedAlert | null {
  if (!Array.isArray(payload.embeds)) return null;
  const embed = obj(arr(payload.embeds)[0]);
  const title = str(embed.title) || str(payload.content);
  if (!title) return null;

  const fields = arr(embed.fields).map(obj);
  return {
    format: "glitchtip-discord",
    title,
    permalink: str(embed.url),
    level: colorToLevel(embed.color),
    project: str(fields.find((f) => str(f.name).toLowerCase() === "project")?.value),
    culprit: str(embed.description),
  };
}

function parseGoogleChatWebhook(payload: Record<string, unknown>): ParsedAlert | null {
  const card = obj(obj(arr(payload.cardsV2)[0]).card);
  const header = obj(card.header);
  const sections = arr(card.sections).map(obj);
  if (!str(header.title) && sections.length === 0) return null;

  // section.header: "<font color='#e52b50'>TypeError: …</font>"
  const section = obj(sections[0]);
  const fontMatch = /<font color='([^']*)'>([\s\S]*)<\/font>/.exec(str(section.header));
  const widgets = arr(section.widgets).map(obj);
  const culpritText = widgets
    .map((w) => obj(w.decoratedText))
    .find((d) => str(d.topLabel) === "Culprit");
  const button = obj(arr(obj(widgets.find((w) => "buttonList" in w)?.buttonList).buttons)[0]);

  return {
    format: "glitchtip-googlechat",
    title: fontMatch?.[2] ?? str(header.title),
    permalink: str(obj(obj(button.onClick).openLink).url),
    level: colorToLevel(fontMatch?.[1]),
    project: str(header.subtitle),
    culprit: str(culpritText?.text),
  };
}

function parseSentryLegacy(payload: Record<string, unknown>): ParsedAlert | null {
  const message = str(payload.message);
  if (!message || (!payload.project && !payload.culprit)) return null;

  return {
    format: "sentry-legacy",
    title: message,
    permalink: str(payload.url),
    level: str(payload.level) || "error",
    project: str(payload.project_name) || str(payload.project),
    culprit: str(payload.culprit),
  };
}

// ── Haupt-Parser ──────────────────────────────────────────────────────────────

/**
 * Erkennt das Payload-Format und mappt auf ParsedAlert.
 * Reihenfolge: spezifische Formate zuerst, der lose General-Webhook-Matcher
 * (greift schon bei vorhandenem text/title) zuletzt.
 */
export function parseAlertPayload(payload: unknown): ParsedAlert | null {
  const p = obj(payload);
  return (
    parseTeamsWebhook(p) ??
    parseDiscordWebhook(p) ??
    parseGoogleChatWebhook(p) ??
    parseSentryLegacy(p) ??
    parseGeneralWebhook(p)
  );
}
