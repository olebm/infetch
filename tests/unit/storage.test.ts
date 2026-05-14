import { describe, expect, it } from "vitest";
import { buildInvoiceStoragePath } from "@/invoices/storage";

describe("invoice storage path", () => {
  it("uses vendor, product and date in the file name", () => {
    const storedPath = buildInvoiceStoragePath({
      originalFilename: "invoice.pdf",
      vendorKey: "openai",
      productLabel: "chatgpt-plus",
      invoiceDate: "2026-05-01",
    });

    expect(storedPath).toContain("openai_chatgpt-plus_2026-05-01.pdf");
  });
});
