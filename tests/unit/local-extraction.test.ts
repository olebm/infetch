import { describe, expect, it } from "vitest";
import { isLocalExtractionSufficient } from "@/invoices/import-pipeline";

const clean = { error: null };
const errored = { error: "Could not parse PDF" };
const fullParsed = { invoiceDate: "2025-04-01", amountGross: 99.0 };
const missingDate = { invoiceDate: null, amountGross: 99.0 };
const missingAmount = { invoiceDate: "2025-04-01", amountGross: null };

describe("isLocalExtractionSufficient", () => {
  it("returns true when vendor, date, amount and confidence are all solid", () => {
    expect(isLocalExtractionSufficient(0.9, fullParsed, clean, 0.96)).toBe(true);
  });

  it("returns false when vendor confidence is below threshold", () => {
    expect(isLocalExtractionSufficient(0.5, fullParsed, clean, 0.8)).toBe(false);
  });

  it("accepts contains-match (0.72 vendor) when data is solid", () => {
    // Mit gelockerter Schwelle: 0.72 vendor + 0.8 overall reicht.
    expect(isLocalExtractionSufficient(0.72, fullParsed, clean, 0.8)).toBe(true);
  });

  it("returns false when invoice date is missing", () => {
    expect(isLocalExtractionSufficient(0.9, missingDate, clean, 0.93)).toBe(false);
  });

  it("returns false when amount is missing", () => {
    expect(isLocalExtractionSufficient(0.9, missingAmount, clean, 0.93)).toBe(false);
  });

  it("returns false when PDF text extraction errored", () => {
    expect(isLocalExtractionSufficient(0.9, fullParsed, errored, 0.7)).toBe(false);
  });

  it("returns false when overall confidence below 0.8", () => {
    expect(isLocalExtractionSufficient(0.9, fullParsed, clean, 0.79)).toBe(false);
  });

  it("returns false at the boundary (0.71 vendor — below 0.72)", () => {
    expect(isLocalExtractionSufficient(0.71, fullParsed, clean, 0.85)).toBe(false);
  });

  it("returns true at the boundary (exactly 0.72 vendor + 0.8 overall)", () => {
    expect(isLocalExtractionSufficient(0.72, fullParsed, clean, 0.8)).toBe(true);
  });
});
