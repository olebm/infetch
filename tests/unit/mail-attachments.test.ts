import { describe, expect, it } from "vitest";
import { extractPdfAttachments } from "@/mail/attachment-extractor";

describe("mail attachment extractor", () => {
  it("extracts PDF attachments and normalizes metadata", async () => {
    const source = Buffer.from(
      [
        "From: Billing <billing@example.com>",
        "To: invoices@example.com",
        "Subject: Your invoice",
        "Message-ID: <invoice-1@example.com>",
        "Date: Fri, 01 May 2026 10:00:00 +0000",
        "MIME-Version: 1.0",
        'Content-Type: multipart/mixed; boundary="b1"',
        "",
        "--b1",
        "Content-Type: text/plain; charset=utf-8",
        "",
        "Invoice attached.",
        "--b1",
        'Content-Type: application/pdf; name="invoice.pdf"',
        "Content-Transfer-Encoding: base64",
        'Content-Disposition: attachment; filename="invoice.pdf"',
        "",
        Buffer.from("%PDF-1.7\nbody").toString("base64"),
        "--b1--",
      ].join("\r\n"),
    );

    const parsed = await extractPdfAttachments(source);

    expect(parsed.messageId).toBe("<invoice-1@example.com>");
    expect(parsed.fromAddress).toBe("billing@example.com");
    expect(parsed.subject).toBe("Your invoice");
    expect(parsed.pdfAttachments).toHaveLength(1);
    expect(parsed.pdfAttachments[0]).toMatchObject({
      filename: "invoice.pdf",
      contentType: "application/pdf",
    });
    expect(parsed.pdfAttachments[0]?.content.subarray(0, 5).toString("ascii")).toBe("%PDF-");
  });
});
