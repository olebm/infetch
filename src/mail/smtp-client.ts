import nodemailer from "nodemailer";
import {
  readCredentialSecret,
  updateCredentialVerificationStatus,
} from "@/lib/secrets/credential-store";
import { getStoredSmtpAccount } from "@/mail/smtp-settings";
import type { SmtpCredentialOwnerId } from "@/mail/smtp-account-slots";
import { renderSubjectTemplate } from "@/lib/recipients";

export type SmtpVerifyResult = {
  label: string;
  host: string;
  port: number;
  username: string;
};

export type SendInvoiceMailOptions = {
  smtpSlot: SmtpCredentialOwnerId;
  organizationId?: string | null;
  to: string;
  vendorName: string;
  invoiceDate: string | null;
  amountGross: number | null;
  currency: string | null;
  /** Optionales Betreff-Template ({{vendor}}/{{date}}/{{amount}}); leer → Default. */
  subjectTemplate?: string | null;
  /** PDF-Inhalt als Buffer (aus Supabase Storage geladen) — kein Dateisystempfad. */
  pdfContent: Buffer;
  originalFilename: string;
};

export async function sendInvoiceMail(options: SendInvoiceMailOptions): Promise<void> {
  const account = await getStoredSmtpAccount(options.smtpSlot);
  if (!account) {
    throw new Error(`SMTP Postfach "${options.smtpSlot}" ist nicht konfiguriert.`);
  }

  const password = await readCredentialSecret({
    scope: "smtp",
    ownerId: options.smtpSlot,
    organizationId: options.organizationId,
  });
  if (!password) {
    throw new Error(`Kein Passwort für SMTP Postfach "${options.smtpSlot}" gefunden.`);
  }

  if (!options.pdfContent || options.pdfContent.byteLength === 0) {
    throw new Error("PDF-Inhalt ist leer.");
  }

  const transporter = nodemailer.createTransport({
    host: account.host,
    port: account.port,
    secure: account.secure,
    auth: { user: account.username, pass: password },
    connectionTimeout: 15_000,
    greetingTimeout: 15_000,
    socketTimeout: 30_000,
  });

  const amountStr =
    options.amountGross != null
      ? `${options.amountGross.toFixed(2)} ${options.currency ?? ""}`.trim()
      : "";
  const template = options.subjectTemplate?.trim();
  const subject = template
    ? renderSubjectTemplate(template, {
        vendor: options.vendorName,
        date: options.invoiceDate,
        amount: amountStr || null,
      })
    : ["Rechnung", options.vendorName, options.invoiceDate ?? null, amountStr || null]
        .filter(Boolean)
        .join(" · ");

  const body = [
    `Rechnung von ${options.vendorName}`,
    options.invoiceDate ? `Datum: ${options.invoiceDate}` : null,
    amountStr ? `Betrag: ${amountStr}` : null,
    "",
    "Diese Nachricht wurde automatisch erstellt.",
  ]
    .filter((l) => l !== null)
    .join("\n");

  try {
    await transporter.sendMail({
      from: account.fromAddress,
      to: options.to,
      subject,
      text: body,
      attachments: [
        {
          filename: options.originalFilename,
          content: options.pdfContent,
          contentType: "application/pdf",
        },
      ],
    });
  } finally {
    transporter.close();
  }
}

export async function verifySmtpAccountConnection(
  ownerId: SmtpCredentialOwnerId,
  organizationId?: string | null,
): Promise<SmtpVerifyResult> {
  const account = await getStoredSmtpAccount(ownerId);
  if (!account) {
    throw new Error(`SMTP Postfach "${ownerId}" ist nicht konfiguriert.`);
  }

  const password = await readCredentialSecret({ scope: "smtp", ownerId, organizationId });
  if (!password) {
    throw new Error(`Kein gespeichertes Passwort für SMTP Postfach "${ownerId}" gefunden.`);
  }

  const transporter = nodemailer.createTransport({
    host: account.host,
    port: account.port,
    secure: account.secure,
    auth: { user: account.username, pass: password },
    connectionTimeout: 10_000,
    greetingTimeout: 10_000,
    socketTimeout: 10_000,
  });

  try {
    await transporter.verify();
  } finally {
    transporter.close();
  }

  await updateCredentialVerificationStatus({
    scope: "smtp",
    ownerId,
    status: "configured",
  });

  const label = ownerId === "primary" ? "SMTP Postfach 1" : "SMTP Postfach 2";
  return { label, host: account.host, port: account.port, username: account.username };
}
