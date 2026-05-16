import { describe, expect, it } from "vitest";
import { parseInvoiceFields } from "@/invoices/parser";

describe("invoice parser", () => {
  it("extracts German date, invoice number, amount and currency", () => {
    const parsed = parseInvoiceFields(`
      Rechnung
      Rechnungsnummer: RG-2026-001
      Rechnungsdatum: 01.05.2026
      Gesamt: 23,00 EUR
    `);

    expect(parsed).toEqual({
      invoiceDate: "2026-05-01",
      invoiceNumber: "RG-2026-001",
      amountGross: 23,
      currency: "EUR",
    });
  });

  it("extracts ISO dates from filenames", () => {
    const parsed = parseInvoiceFields("Total: 8.21 EUR", "2026-05-02_hetzner_invoice.pdf");

    expect(parsed.invoiceDate).toBe("2026-05-02");
    expect(parsed.amountGross).toBe(8.21);
  });

  it("parses thousands separators (de + us)", () => {
    expect(parseInvoiceFields("Gesamt: 1.234.567,89 EUR").amountGross).toBe(1234567.89);
    expect(parseInvoiceFields("Total: 1,234,567.89 USD").amountGross).toBe(1234567.89);
    expect(parseInvoiceFields("Betrag: 1.234,56 EUR").amountGross).toBe(1234.56);
  });

  it("treats a single grouping separator with 3 digits as thousands", () => {
    expect(parseInvoiceFields("Total: 1,234 EUR").amountGross).toBe(1234);
  });

  it("handles zero and negative / credit amounts", () => {
    expect(parseInvoiceFields("Gesamt: 0,00 EUR").amountGross).toBe(0);
    expect(parseInvoiceFields("Betrag: -12,50 EUR").amountGross).toBe(-12.5);
    expect(parseInvoiceFields("Total: (99,00) EUR").amountGross).toBe(-99);
  });

  it("rejects calendar-invalid dates", () => {
    expect(parseInvoiceFields("Rechnungsdatum: 31.02.2026").invoiceDate).toBeNull();
    expect(parseInvoiceFields("Rechnungsdatum: 29.02.2026").invoiceDate).toBeNull();
    expect(parseInvoiceFields("Rechnungsdatum: 28.02.2026").invoiceDate).toBe("2026-02-28");
  });
});
