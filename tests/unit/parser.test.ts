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
});
