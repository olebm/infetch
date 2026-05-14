import Database from "better-sqlite3";
import { describe, expect, it } from "vitest";
import { schemaStatements } from "@/lib/db/schema";
import { seedDatabase } from "@/vendors/seed";
import { matchVendor } from "@/vendors/matcher";

function createDb() {
  const db = new Database(":memory:");
  db.pragma("foreign_keys = ON");
  for (const statement of schemaStatements) {
    db.exec(statement);
  }
  seedDatabase(db);
  return db;
}

describe("vendor matcher", () => {
  it("matches aliases against filename and text", () => {
    const db = createDb();
    const match = matchVendor(db, ["invoice-openai-may.pdf", "OpenAI Ireland Ltd. invoice"]);

    expect(match.canonicalKey).toBe("openai");
    expect(match.vendorId).toEqual(expect.any(Number));
  });

  it("maps Claude portal text to the canonical Anthropic vendor", () => {
    const db = createDb();
    const match = matchVendor(db, ["claude.ai receipt", "Claude subscription"]);

    expect(match.canonicalKey).toBe("anthropic");
  });
});
