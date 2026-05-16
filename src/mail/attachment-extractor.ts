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

// Hard-Cap für die rohe MIME-Größe. simpleParser() dekodiert die GESAMTE
// Mail (inkl. aller Anhänge) in den RAM, bevor die 20-MB-PDF-Grenze greift.
// Eine 100-MB+-Mail würde sonst den Scanner-Prozess (single process) per
// OOM mitreißen. 35 MB ≈ 20-MB-PDF base64 (+~33 %) + Header/Body.
const MAX_RAW_MAIL_BYTES = Number(process.env.MAX_RAW_MAIL_BYTES ?? 35 * 1024 * 1024);

const EMPTY_RESULT: ParsedMailForInvoices = {
  messageId: null,
  fromAddress: null,
  fromName: null,
  subject: null,
  date: null,
  pdfAttachments: [],
};

export async function extractPdfAttachments(source: Buffer): Promise<ParsedMailForInvoices> {
  if (source.byteLength > MAX_RAW_MAIL_BYTES) {
    // Übergroße Mail nicht parsen (Memory-DoS-Schutz). Wird vom Scanner
    // wie eine Mail ohne PDF behandelt.
    return { ...EMPTY_RESULT };
  }
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

type BodyStructureNode = {
  type?: string;
  parameters?: { [key: string]: string };
  dispositionParameters?: { [key: string]: string };
  childNodes?: BodyStructureNode[];
};

/**
 * True wenn die IMAP-BODYSTRUCTURE einen PDF-Part enthält. Erlaubt es, den
 * Volltext nur für Mails mit PDF-Anhang nachzuladen (Datenminimierung) —
 * private Mails ohne Anhang werden nie heruntergeladen oder geparst.
 */
export function bodyStructureHasPdf(node: BodyStructureNode | null | undefined): boolean {
  if (!node) return false;
  if ((node.type || "").toLowerCase() === "application/pdf") return true;
  const name = node.parameters?.name || node.dispositionParameters?.filename || "";
  if (name.toLowerCase().endsWith(".pdf")) return true;
  return (node.childNodes || []).some(bodyStructureHasPdf);
}

function normalizePdfFilename(filename: string | undefined, messageId: string | undefined, index: number) {
  if (filename?.toLowerCase().endsWith(".pdf")) return filename;
  const source = messageId ? messageId.replace(/[^a-z0-9]+/gi, "-").slice(0, 60) : `mail-attachment-${index + 1}`;
  return `${source || "mail-attachment"}.pdf`;
}
