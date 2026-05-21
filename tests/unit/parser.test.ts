import { describe, expect, it } from "vitest";
import { parseInvoiceFields } from "@/invoices/parser";

describe("invoice parser", () => {
  it("extracts German date, invoice number, amount and currency", () => {
    const parsed = parseInvoiceFields(`
      Rechnung
      Rechnungsnummer: RG-2023-001
      Rechnungsdatum: 01.05.2023
      Gesamt: 23,00 EUR
    `);

    expect(parsed).toEqual({
      invoiceDate: "2023-05-01",
      invoiceNumber: "RG-2023-001",
      amountGross: 23,
      currency: "EUR",
    });
  });

  it("extracts ISO dates from filenames", () => {
    const parsed = parseInvoiceFields("Total: 8.21 EUR", "2023-05-02_hetzner_invoice.pdf");

    expect(parsed.invoiceDate).toBe("2023-05-02");
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
    expect(parseInvoiceFields("Rechnungsdatum: 31.02.2023").invoiceDate).toBeNull();
    expect(parseInvoiceFields("Rechnungsdatum: 29.02.2023").invoiceDate).toBeNull();
    expect(parseInvoiceFields("Rechnungsdatum: 28.02.2023").invoiceDate).toBe("2023-02-28");
  });

  it("rejects future invoice dates (likely a misread due/reminder date)", () => {
    expect(parseInvoiceFields("Rechnungsdatum: 05.12.2099").invoiceDate).toBeNull();
    expect(parseInvoiceFields("Rechnungsdatum: 2099-12-05").invoiceDate).toBeNull();
  });

  it("rejects amounts with inconsistent thousand grouping", () => {
    // Verklebte/zerrissene OCR-Zahl → unzuverlässig → null (statt Müll).
    expect(parseInvoiceFields("Gesamt: 12.34.567,89 EUR").amountGross).toBeNull();
  });
});
