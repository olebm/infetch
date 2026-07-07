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

  // Englische Monatsnamen-Daten (Stripe/Paddle-Belege von US/intl. SaaS wie
  // Mistral, OpenAI, GitHub). Zuvor fiel das Datum durch → Rechnung blieb ohne
  // Datum in "prüfen" hängen und war nicht exportbereit.
  it("extracts English month-name dates (month first, various forms)", () => {
    expect(parseInvoiceFields("Date paid July 7, 2023").invoiceDate).toBe("2023-07-07");
    expect(parseInvoiceFields("Jul 7 2023").invoiceDate).toBe("2023-07-07");
    expect(parseInvoiceFields("Issued: July 7th, 2023").invoiceDate).toBe("2023-07-07");
    expect(parseInvoiceFields("Sept 5, 2023").invoiceDate).toBe("2023-09-05");
    expect(parseInvoiceFields("December 31, 2023").invoiceDate).toBe("2023-12-31");
  });

  it("extracts English month-name dates (day first)", () => {
    expect(parseInvoiceFields("7 July 2023").invoiceDate).toBe("2023-07-07");
    expect(parseInvoiceFields("07 Jul 2023").invoiceDate).toBe("2023-07-07");
    expect(parseInvoiceFields("Invoice date: 5th September 2023").invoiceDate).toBe("2023-09-05");
  });

  it("applies calendar + future guards to English dates too", () => {
    expect(parseInvoiceFields("February 31, 2023").invoiceDate).toBeNull();
    expect(parseInvoiceFields("December 5, 2099").invoiceDate).toBeNull();
  });

  it("keeps ISO/German precedence when an English date is also present", () => {
    // DE-Rechnungsdatum muss gewinnen, auch wenn ein engl. Fälligkeitsdatum daneben steht.
    const parsed = parseInvoiceFields(`
      Rechnungsdatum: 01.05.2023
      Payment due July 30, 2023
    `);
    expect(parsed.invoiceDate).toBe("2023-05-01");
  });

  it("parses a Mistral/Stripe-style receipt that previously lost its date", () => {
    const parsed = parseInvoiceFields(`
      Mistral AI SAS
      Receipt MSTRL-API-788844-RCPT-000007
      Date paid: July 7, 2023
      Amount paid €0.80
    `);
    expect(parsed.invoiceDate).toBe("2023-07-07");
  });
});
