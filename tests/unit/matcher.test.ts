import { describe, expect, it } from "vitest";
import { matchVendor } from "@/vendors/matcher";

// NOTE: matchVendor now uses the global postgres sql client.
// This test requires a real Postgres connection with seeded vendor data.

describe("vendor matcher", () => {
  it("matches aliases against filename and text", async () => {
    const match = await matchVendor(["invoice-openai-may.pdf", "OpenAI Ireland Ltd. invoice"]);

    expect(match.canonicalKey).toBe("openai");
    expect(match.vendorId).toEqual(expect.any(Number));
  });

  it("maps Claude portal text to the canonical Anthropic vendor", async () => {
    const match = await matchVendor(["claude.ai receipt", "Claude subscription"]);

    expect(match.canonicalKey).toBe("anthropic");
  });
});
