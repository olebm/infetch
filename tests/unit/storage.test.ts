import { describe, expect, it } from "vitest";
import { buildInvoiceStoragePath } from "@/invoices/storage";

describe("invoice storage path", () => {
  it("uses vendor, product, date and content-hash in the file name", () => {
    const storedPath = buildInvoiceStoragePath({
      orgId: null,
      vendorKey: "openai",
      productLabel: "chatgpt-plus",
      invoiceDate: "2026-05-01",
      // sha256 ist seit INFETCH-243 Pflicht → Eindeutigkeit pro Inhalt.
      sha256: "f".repeat(64),
    });

    expect(storedPath).toContain("openai_chatgpt-plus_2026-05-01_");
    expect(storedPath.endsWith(".pdf")).toBe(true);
    expect(storedPath).toContain("ffffffff");
  });
});
