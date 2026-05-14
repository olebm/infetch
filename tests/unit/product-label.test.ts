import { describe, expect, it } from "vitest";
import { deriveInvoiceProductLabel } from "@/invoices/product-label";

describe("invoice product label", () => {
  it("derives vendor-specific product labels from text", () => {
    const label = deriveInvoiceProductLabel({
      vendorKey: "openai",
      originalFilename: "invoice.pdf",
      text: "Your ChatGPT Plus subscription invoice",
    });

    expect(label).toBe("chatgpt-plus");
  });

  it("falls back when no product can be inferred", () => {
    const label = deriveInvoiceProductLabel({
      vendorKey: "openai",
      originalFilename: "invoice.pdf",
      text: "OpenAI Ireland Ltd.",
    });

    expect(label).toBe("unknown-product");
  });
});
