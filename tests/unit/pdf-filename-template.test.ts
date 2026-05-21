import { describe, it, expect } from "vitest";
import { renderPdfFilenameTemplate, DEFAULT_PDF_FILENAME_TEMPLATE } from "@/lib/recipients";

describe("renderPdfFilenameTemplate", () => {
  it("renders all three tokens and normalises spaces to underscores", () => {
    const result = renderPdfFilenameTemplate(DEFAULT_PDF_FILENAME_TEMPLATE, {
      vendor: "Telekom",
      date: "2026-05-12",
      amount: "149,00 EUR",
    });
    // spaces in "149,00 EUR" become underscores
    expect(result).toBe("Telekom_2026-05-12_149,00_EUR.pdf");
  });

  it("collapses double underscore when a token is missing", () => {
    const result = renderPdfFilenameTemplate("{{vendor}}_{{date}}_{{amount}}.pdf", {
      vendor: "Slack",
      date: null,
      amount: null,
    });
    // "Slack__" → "Slack" after collapse
    expect(result).toBe("Slack.pdf");
  });

  it("falls back to Rechnung.pdf when all tokens are empty", () => {
    const result = renderPdfFilenameTemplate("{{vendor}}_{{date}}.pdf", {
      vendor: null,
      date: null,
      amount: null,
    });
    expect(result).toBe("Rechnung.pdf");
  });

  it("strips filesystem-unsafe characters", () => {
    const result = renderPdfFilenameTemplate("{{vendor}}_{{date}}.pdf", {
      vendor: 'A/B:C*D?"E<F>G|H',
      date: "2026-01-01",
      amount: null,
    });
    expect(result).not.toMatch(/[/\\:*?"<>|]/);
    expect(result).toContain("ABCDEFGH");
  });

  it("ensures .pdf extension even when template omits it", () => {
    const result = renderPdfFilenameTemplate("{{vendor}}_{{date}}", {
      vendor: "Notion",
      date: "2026-03-01",
      amount: null,
    });
    expect(result).toMatch(/\.pdf$/);
  });

  it("strips leading and trailing underscores", () => {
    const result = renderPdfFilenameTemplate("_{{vendor}}_.pdf", {
      vendor: "Figma",
      date: null,
      amount: null,
    });
    expect(result).toBe("Figma.pdf");
  });
});
