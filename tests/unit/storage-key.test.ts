import { describe, expect, it } from "vitest";
import crypto from "node:crypto";
import { buildInvoiceStorageKey, pdfContentMatches } from "@/lib/supabase/storage";

const base = {
  orgId: "org-1",
  vendorKey: "microsoft",
  productLabel: "azure",
  invoiceDate: "2026-06-02",
  fallbackDate: "2026-06-04",
};

describe("buildInvoiceStorageKey – Eindeutigkeit (INFETCH-243)", () => {
  it("erzeugt für unterschiedliche sha256 unterschiedliche Keys (kein Überschreiben)", () => {
    const a = buildInvoiceStorageKey({ ...base, sha256: "a".repeat(64) });
    const b = buildInvoiceStorageKey({ ...base, sha256: "b".repeat(64) });
    expect(a).not.toBe(b);
    expect(a).toContain("aaaaaaaa");
    expect(b).toContain("bbbbbbbb");
  });

  it("bleibt stabil für identische Eingaben", () => {
    expect(buildInvoiceStorageKey({ ...base, sha256: "c".repeat(64) })).toBe(
      buildInvoiceStorageKey({ ...base, sha256: "c".repeat(64) }),
    );
  });

  it("kollidiert NICHT bei unknown-vendor/-product gleichen Datums (der Prod-Bug)", () => {
    // Genau der Prod-Fall: Vendor+Produkt unbekannt, gleicher Tag, andere Inhalte.
    // Vor dem Fix erzeugten beide denselben Key → upsert:true überschrieb.
    const shared = {
      orgId: "73b3d5e1",
      vendorKey: null,
      productLabel: null,
      invoiceDate: "2026-06-02",
    };
    const a = buildInvoiceStorageKey({ ...shared, sha256: "1".repeat(64) });
    const b = buildInvoiceStorageKey({ ...shared, sha256: "2".repeat(64) });
    expect(a).toContain("unknown-vendor");
    expect(a).not.toBe(b);
  });
});

describe("pdfContentMatches – Fail-closed Integritäts-Gate (INFETCH-243)", () => {
  const buf = Buffer.from("%PDF-1.7 echtes Rechnungs-PDF");
  const sha = crypto.createHash("sha256").update(buf).digest("hex");

  it("true, wenn der Inhalt zum erwarteten sha256 passt", () => {
    expect(pdfContentMatches(buf, sha)).toBe(true);
  });

  it("false, wenn der Inhalt NICHT passt (überschriebenes/falsches PDF → nicht ausliefern)", () => {
    expect(pdfContentMatches(Buffer.from("ein ANDERES PDF"), sha)).toBe(false);
  });

  it("true, wenn kein erwarteter sha256 vorliegt (Legacy-Zeile, nicht prüfbar)", () => {
    expect(pdfContentMatches(buf, null)).toBe(true);
  });
});
