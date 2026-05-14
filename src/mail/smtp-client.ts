import fs from "node:fs";
import nodemailer from "nodemailer";
import type Database from "better-sqlite3";
import { getDb } from "@/lib/db/client";
import { readCredentialSecret } from "@/lib/secrets/credential-store";
import { getStoredSmtpAccount } from "@/mail/smtp-settings";
import { updateCredentialVerificationStatus } from "@/lib/secrets/credential-store";
import type { SmtpCredentialOwnerId } from "@/mail/smtp-account-slots";

export type SmtpVerifyResult = {
  label: string;
  host: string;
  port: number;
  username: string;
};

export type SendInvoiceMailOptions = {
  smtpSlot: SmtpCredentialOwnerId;
  to: string;
  vendorName: string;
  invoiceDate: string | null;
  amountGross: number | null;
  currency: string | null;
  pdfPath: string;
  originalFilename: string;
  db?: Database.Database;
};

export async function sendInvoiceMail(options: SendInvoiceMailOptions): Promise<void> {
  const resolvedDb = options.db ?? getDb();
  const account = getStoredSmtpAccount(options.smtpSlot, resolvedDb);
  if (!account) {
    throw new Error(`SMTP Postfach "${options.smtpSlot}" ist nicht konfiguriert.`);
  }

  const password = await readCredentialSecret({ scope: "smtp", ownerId: options.smtpSlot, db: resolvedDb });
  if (!password) {
    throw new Error(`Kein Passwort für SMTP Postfach "${options.smtpSlot}" gefunden.`);
  }

  if (!fs.existsSync(options.pdfPath)) {
    throw new Error(`PDF-Datei nicht gefunden: ${options.pdfPath}`);
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
  const subject = [
    "Rechnung",
    options.vendorName,
    options.invoiceDate ?? null,
    amountStr || null,
  ]
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
          path: options.pdfPath,
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
  db?: Database.Database,
): Promise<SmtpVerifyResult> {
  const resolvedDb = db || getDb();
  const account = getStoredSmtpAccount(ownerId, resolvedDb);
  if (!account) {
    throw new Error(`SMTP Postfach "${ownerId}" ist nicht konfiguriert.`);
  }

  const password = await readCredentialSecret({ scope: "smtp", ownerId, db: resolvedDb });
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

  updateCredentialVerificationStatus({
    db: resolvedDb,
    scope: "smtp",
    ownerId,
    status: "configured",
  });

  const label = ownerId === "primary" ? "SMTP Postfach 1" : "SMTP Postfach 2";
  return { label, host: account.host, port: account.port, username: account.username };
}
