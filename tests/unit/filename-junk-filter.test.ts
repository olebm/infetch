import { describe, expect, it } from "vitest";
import { classifyFilenameAsJunk } from "@/invoices/filename-junk-filter";

describe("classifyFilenameAsJunk", () => {
  // ── Junk-Patterns ────────────────────────────────────────────────────────────

  it("erkennt AGB-Dateien", () => {
    expect(classifyFilenameAsJunk("AGB_Shop.pdf").isJunk).toBe(true);
    expect(classifyFilenameAsJunk("allgemeine_geschaeftsbedingungen.pdf").isJunk).toBe(true);
  });

  it("erkennt Widerrufsbelehrungen", () => {
    expect(classifyFilenameAsJunk("Widerrufsbelehrung.pdf").isJunk).toBe(true);
    expect(classifyFilenameAsJunk("widerrufsrecht_info.pdf").isJunk).toBe(true);
    expect(classifyFilenameAsJunk("widerruf_formular.pdf").isJunk).toBe(true);
  });

  it("erkennt Datenschutz-Dokumente", () => {
    expect(classifyFilenameAsJunk("Datenschutzerklaerung_2026.pdf").isJunk).toBe(true);
    expect(classifyFilenameAsJunk("privacy_policy.pdf").isJunk).toBe(true);
    expect(classifyFilenameAsJunk("privacy-policy_v2.pdf").isJunk).toBe(true);
  });

  it("erkennt Terms-of-Service-Dateien", () => {
    expect(classifyFilenameAsJunk("terms_of_service.pdf").isJunk).toBe(true);
    expect(classifyFilenameAsJunk("terms-conditions.pdf").isJunk).toBe(true);
    expect(classifyFilenameAsJunk("t_and_c.pdf").isJunk).toBe(true);
  });

  it("erkennt Boarding Passes und Tickets", () => {
    expect(classifyFilenameAsJunk("boarding_pass_LH1234.pdf").isJunk).toBe(true);
    expect(classifyFilenameAsJunk("flugticket_mai.pdf").isJunk).toBe(true);
    expect(classifyFilenameAsJunk("ticket_concert.pdf").isJunk).toBe(true);
  });

  it("erkennt AVV/DPA-Dokumente", () => {
    expect(classifyFilenameAsJunk("av_vertrag_2026.pdf").isJunk).toBe(true);
    expect(classifyFilenameAsJunk("avv_unterschrieben.pdf").isJunk).toBe(true);
    expect(classifyFilenameAsJunk("dpa_anthropic.pdf").isJunk).toBe(true);
    expect(classifyFilenameAsJunk("data_processing_agreement.pdf").isJunk).toBe(true);
  });

  it("erkennt Preislisten", () => {
    expect(classifyFilenameAsJunk("preisliste_2026.pdf").isJunk).toBe(true);
    expect(classifyFilenameAsJunk("price_list_q1.pdf").isJunk).toBe(true);
  });

  it("ist case-insensitiv", () => {
    expect(classifyFilenameAsJunk("AGB.PDF").isJunk).toBe(true);
    expect(classifyFilenameAsJunk("DATENSCHUTZ.pdf").isJunk).toBe(true);
    expect(classifyFilenameAsJunk("BOARDING_PASS.pdf").isJunk).toBe(true);
  });

  it("betrachtet nur den Dateinamen, ignoriert Pfad-Präfixe", () => {
    expect(classifyFilenameAsJunk("/downloads/mail/AGB_Shop.pdf").isJunk).toBe(true);
    expect(classifyFilenameAsJunk("uploads/2026/invoice-openai.pdf").isJunk).toBe(false);
  });

  it("gibt matchedPattern zurück wenn Junk erkannt", () => {
    const result = classifyFilenameAsJunk("AGB_2026.pdf");
    expect(result.isJunk).toBe(true);
    expect(result.matchedPattern).toBeTruthy();
  });

  // ── Echte Rechnungen — dürfen NICHT als Junk markiert werden ────────────────

  it("markiert echte Rechnungen nicht als Junk", () => {
    const safeFilenames = [
      "invoice-openai-may-2026.pdf",
      "rechnung_hetzner_2026-04.pdf",
      "stripe_receipt_2026.pdf",
      "2026-05-01_anthropic_invoice.pdf",
      "bill_aws_q1.pdf",
      "subscription_netflix.pdf",
      "beleg_steuerbüro.pdf",
    ];
    for (const name of safeFilenames) {
      const result = classifyFilenameAsJunk(name);
      expect(result.isJunk, `"${name}" sollte keine Junk sein`).toBe(false);
    }
  });

  // ── Edge Cases ────────────────────────────────────────────────────────────────

  it("behandelt null/undefined/leer sicher", () => {
    expect(classifyFilenameAsJunk(null).isJunk).toBe(false);
    expect(classifyFilenameAsJunk(undefined).isJunk).toBe(false);
    expect(classifyFilenameAsJunk("").isJunk).toBe(false);
  });

  it("gibt matchedPattern: null zurück wenn kein Junk", () => {
    const result = classifyFilenameAsJunk("invoice.pdf");
    expect(result.isJunk).toBe(false);
    expect(result.matchedPattern).toBeNull();
  });
});
