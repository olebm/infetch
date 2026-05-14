import { simpleParser } from "mailparser";

export type ParsedMailPdfAttachment = {
  filename: string;
  contentType: string;
  content: Buffer;
};

export type ParsedMailForInvoices = {
  messageId: string | null;
  fromAddress: string | null;
  fromName: string | null;
  subject: string | null;
  date: Date | null;
  pdfAttachments: ParsedMailPdfAttachment[];
};

export async function extractPdfAttachments(source: Buffer): Promise<ParsedMailForInvoices> {
  const parsed = await simpleParser(source);
  const pdfAttachments = parsed.attachments
    .filter((attachment) => {
      const filename = attachment.filename || "";
      return attachment.contentType === "application/pdf" || filename.toLowerCase().endsWith(".pdf");
    })
    .map((attachment, index) => ({
      filename: normalizePdfFilename(attachment.filename, parsed.messageId, index),
      contentType: attachment.contentType || "application/pdf",
      content: attachment.content,
    }));

  const fromEntry = parsed.from?.value[0];
  return {
    messageId: parsed.messageId || null,
    fromAddress: fromEntry?.address || null,
    fromName: fromEntry?.name?.trim() || null,
    subject: parsed.subject || null,
    date: parsed.date || null,
    pdfAttachments,
  };
}

function normalizePdfFilename(filename: string | undefined, messageId: string | undefined, index: number) {
  if (filename?.toLowerCase().endsWith(".pdf")) return filename;
  const source = messageId ? messageId.replace(/[^a-z0-9]+/gi, "-").slice(0, 60) : `mail-attachment-${index + 1}`;
  return `${source || "mail-attachment"}.pdf`;
}
