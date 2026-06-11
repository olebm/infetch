import { afterEach, describe, expect, it, vi } from "vitest";
import { POST } from "@/app/api/sentry-webhook/route";

// INFETCH-274: Das Glitchtip-Webhook schreibt auf Disk (data/sentry-errors.jsonl)
// und war unauthentifiziert. Jetzt: Shared-Secret (?token=, timing-safe) +
// Body-Größenlimit. Diese Tests sichern die Auth-/Limit-Gates ab.

function post(url: string, body: string): Request {
  return new Request(url, { method: "POST", body });
}

describe("sentry-webhook auth + size limit (INFETCH-274)", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("lehnt ein falsches Token ab (401), wenn ein Secret konfiguriert ist", async () => {
    vi.stubEnv("SENTRY_WEBHOOK_SECRET", "s3cret");
    const res = await POST(post("https://app.infetch.de/api/sentry-webhook?token=wrong", "{}"));
    expect(res.status).toBe(401);
  });

  it("lehnt ohne Token ab (401), wenn ein Secret konfiguriert ist", async () => {
    vi.stubEnv("SENTRY_WEBHOOK_SECRET", "s3cret");
    const res = await POST(post("https://app.infetch.de/api/sentry-webhook", "{}"));
    expect(res.status).toBe(401);
  });

  it("akzeptiert das korrekte Token (200)", async () => {
    vi.stubEnv("SENTRY_WEBHOOK_SECRET", "s3cret");
    const res = await POST(post("https://app.infetch.de/api/sentry-webhook?token=s3cret", "{}"));
    expect(res.status).toBe(200);
  });

  it("lehnt einen zu großen Payload ab (413), bevor geschrieben wird", async () => {
    vi.stubEnv("SENTRY_WEBHOOK_SECRET", "s3cret");
    const big = "x".repeat(70 * 1024);
    const res = await POST(post("https://app.infetch.de/api/sentry-webhook?token=s3cret", big));
    expect(res.status).toBe(413);
  });

  it("ist fail-closed ohne Secret außerhalb von development (401)", async () => {
    vi.stubEnv("SENTRY_WEBHOOK_SECRET", "");
    vi.stubEnv("NODE_ENV", "production");
    const res = await POST(post("https://app.infetch.de/api/sentry-webhook", "{}"));
    expect(res.status).toBe(401);
  });
});
