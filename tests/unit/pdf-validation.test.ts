import { describe, expect, it } from "vitest";
import { isLikelyPdf, maxPdfSizeBytes } from "@/invoices/pdf-validation";

describe("PDF validation", () => {
  it("accepts buffers with a PDF header", () => {
    expect(isLikelyPdf(Buffer.from("%PDF-1.7\nbody"))).toBe(true);
  });

  it("rejects renamed non-PDF content", () => {
    expect(isLikelyPdf(Buffer.from("not a pdf"))).toBe(false);
  });

  it("keeps manual uploads capped at 20 MB", () => {
    expect(maxPdfSizeBytes).toBe(20 * 1024 * 1024);
  });
});
