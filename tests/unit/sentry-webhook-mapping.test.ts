import { readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { POST } from "@/app/api/sentry-webhook/route";
import { parseAlertPayload } from "@/lib/sentry/parse-alert";

// Incident 2026-06-11: data/sentry-errors.jsonl enthielt neun Einträge mit
// title="Unbekannter Fehler" und leeren permalink/project/culprit-Feldern.
// Zwei Ursachen: (a) Payloads, deren Format der Parser nicht kannte, liefen
// kommentarlos als kontextloser Leereintrag ein — nicht diagnostizierbar;
// (b) der Auth-Test POSTete "{}" und schrieb dabei in die ECHTE Datei.
// Diese Tests machen beide Fehlerbilder dauerhaft rot.

// ── Payload-Fixtures — exakt nach glitchtip-backend apps/alerts/webhooks.py ──

const PERMALINK = "https://glitchtip.betaform.io/betaform/issues/42";
const TITLE = "TypeError: Cannot read properties of undefined (reading 'id')";
const CULPRIT = "GET /api/invoices";

const GENERAL_WEBHOOK_PAYLOAD = {
  text: "GlitchTip Alert",
  attachments: [
    {
      mrkdown_in: ["text"],
      title: TITLE,
      title_link: PERMALINK,
      text: CULPRIT,
      image_url: null,
      color: "#e52b50",
      fields: [
        { title: "Project", value: "infetch", short: true },
        { title: "Environment", value: "production", short: true },
        { title: "Release", value: "8052a9e", short: false },
      ],
    },
  ],
};

const MSTEAMS_PAYLOAD = {
  type: "message",
  attachments: [
    {
      contentType: "application/vnd.microsoft.card.adaptive",
      contentUrl: null,
      content: {
        $schema: "http://adaptivecards.io/schemas/adaptive-card.json",
        type: "AdaptiveCard",
        version: "1.4",
        body: [
          { type: "TextBlock", size: "Large", weight: "Bolder", text: "GlitchTip Alert" },
          { type: "TextBlock", weight: "Bolder", color: "Attention", text: TITLE, wrap: true },
          { type: "TextBlock", text: CULPRIT, wrap: true },
          {
            type: "FactSet",
            facts: [
              { title: "Project", value: "infetch" },
              { title: "Environment", value: "production" },
            ],
          },
        ],
        actions: [{ type: "Action.OpenUrl", title: "View Issue INFETCH-2A", url: PERMALINK }],
      },
    },
  ],
};

const DISCORD_PAYLOAD = {
  content: "GlitchTip Alert",
  embeds: [
    {
      title: TITLE,
      description: CULPRIT,
      color: 0xe52b50,
      url: PERMALINK,
      fields: [{ name: "Project", value: "infetch", inline: true }],
    },
  ],
};

const GOOGLECHAT_PAYLOAD = {
  cardsV2: [
    {
      cardId: "createCardMessage",
      card: {
        header: { title: "GlitchTip Alert", subtitle: "infetch" },
        sections: [
          {
            header: `<font color='#e52b50'>${TITLE}</font>`,
            widgets: [
              { decoratedText: { topLabel: "Culprit", text: CULPRIT } },
              { decoratedText: { topLabel: "Environment", text: "production" } },
              {
                buttonList: {
                  buttons: [
                    {
                      text: "View Issue INFETCH-2A",
                      onClick: { openLink: { url: PERMALINK } },
                    },
                  ],
                },
              },
            ],
          },
        ],
      },
    },
  ],
};

const SENTRY_LEGACY_PAYLOAD = {
  project: "infetch",
  project_name: "infetch",
  culprit: CULPRIT,
  level: "warning",
  url: PERMALINK,
  message: TITLE,
  event: { event_id: "abc123" },
};

const KNOWN_PAYLOADS: Record<string, unknown> = {
  "glitchtip-webhook": GENERAL_WEBHOOK_PAYLOAD,
  "glitchtip-msteams": MSTEAMS_PAYLOAD,
  "glitchtip-discord": DISCORD_PAYLOAD,
  "glitchtip-googlechat": GOOGLECHAT_PAYLOAD,
  "sentry-legacy": SENTRY_LEGACY_PAYLOAD,
};

// ── Mapping (pur) ─────────────────────────────────────────────────────────────

describe("parseAlertPayload — Format-Mapping", () => {
  it.each(Object.entries(KNOWN_PAYLOADS))(
    "mappt %s vollständig — nie wieder kontextloser Leereintrag",
    (format, payload) => {
      const parsed = parseAlertPayload(payload);
      expect(parsed).not.toBeNull();
      expect(parsed!.format).toBe(format);
      expect(parsed!.title).toBe(TITLE);
      expect(parsed!.permalink).toBe(PERMALINK);
      expect(parsed!.project).toBe("infetch");
      expect(parsed!.culprit).toBe(CULPRIT);
      expect(parsed!.level).not.toBe("");
    },
  );

  it.each([
    ["#e52b50", "error"],
    ["#e9b949", "warning"],
    ["#4b60b4", "info"],
    ["danger", "error"],
    ["warning", "warning"],
    ["good", "info"],
  ])("mappt Glitchtip-Farbe %s auf Level %s", (color, level) => {
    const payload = {
      ...GENERAL_WEBHOOK_PAYLOAD,
      attachments: [{ ...GENERAL_WEBHOOK_PAYLOAD.attachments[0], color }],
    };
    expect(parseAlertPayload(payload)?.level).toBe(level);
  });

  it.each([
    [0xe52b50, "error"],
    [0xe9b949, "warning"],
    [0x4b60b4, "info"],
  ])("mappt Discord-Integer-Farbe %d auf Level %s", (color, level) => {
    const payload = {
      ...DISCORD_PAYLOAD,
      embeds: [{ ...DISCORD_PAYLOAD.embeds[0], color }],
    };
    expect(parseAlertPayload(payload)?.level).toBe(level);
  });

  it("bevorzugt beim Sentry-Legacy-Format den Anzeigenamen über den Slug", () => {
    const parsed = parseAlertPayload({ ...SENTRY_LEGACY_PAYLOAD, project_name: "Infetch GmbH" });
    expect(parsed?.project).toBe("Infetch GmbH");
  });

  it("liefert null für unbekannte Payloads statt eines erfundenen Eintrags", () => {
    expect(parseAlertPayload({})).toBeNull();
    expect(parseAlertPayload({ foo: "bar" })).toBeNull();
    expect(parseAlertPayload(null)).toBeNull();
    expect(parseAlertPayload([1, 2, 3])).toBeNull();
  });
});

// ── End-to-End über den POST-Handler ──────────────────────────────────────────

function post(body: string): Request {
  return new Request("https://app.infetch.de/api/sentry-webhook?token=s3cret", {
    method: "POST",
    body,
  });
}

function readEntries(file: string): Array<Record<string, unknown>> {
  return readFileSync(file, "utf8")
    .trim()
    .split("\n")
    .map((line) => JSON.parse(line) as Record<string, unknown>);
}

describe("POST /api/sentry-webhook — JSONL-Einträge", () => {
  let logFile: string;

  beforeEach(() => {
    logFile = join(tmpdir(), `sentry-mapping-test-${process.pid}-${Date.now()}.jsonl`);
    vi.stubEnv("SENTRY_ERRORS_FILE", logFile);
    vi.stubEnv("SENTRY_WEBHOOK_SECRET", "s3cret");
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    rmSync(logFile, { force: true });
  });

  it("schreibt eine Glitchtip-General-Webhook-Payload vollständig gemappt", async () => {
    const res = await POST(post(JSON.stringify(GENERAL_WEBHOOK_PAYLOAD)));
    expect(res.status).toBe(200);

    const entries = readEntries(logFile);
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({
      title: TITLE,
      permalink: PERMALINK,
      level: "error",
      project: "infetch",
      culprit: CULPRIT,
      format: "glitchtip-webhook",
    });
  });

  it("loggt bei unbekanntem Format ein Roh-Sample — Fehlerbild bleibt diagnostizierbar", async () => {
    const res = await POST(post("{}"));
    expect(res.status).toBe(200);

    const entries = readEntries(logFile);
    expect(entries).toHaveLength(1);
    expect(entries[0].format).toBe("unknown");
    expect(entries[0].raw).toBe("{}");
  });
});

// Kein beforeEach-Stub hier: prüft den globalen Default aus tests/setup.ts.
describe("Test-Isolation (Incident-Ursache b)", () => {
  it("leitet Testläufe per Setup-Guard von data/sentry-errors.jsonl weg", () => {
    const target = process.env.SENTRY_ERRORS_FILE ?? "";
    expect(target).not.toBe("");
    expect(target).not.toContain(join("data", "sentry-errors.jsonl"));
  });
});
