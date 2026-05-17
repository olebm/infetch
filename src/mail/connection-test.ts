"use server";

import { ImapFlow } from "imapflow";
import nodemailer from "nodemailer";
import { requireCurrentAuth } from "@/lib/auth/current";

export type ProtoResult = { ok: boolean; error?: string };
export type ConnectionTestResult = { imap: ProtoResult; smtp: ProtoResult };

export async function testMailConnectionAction(
  _prev: ConnectionTestResult | null,
  formData: FormData,
): Promise<ConnectionTestResult> {
  await requireCurrentAuth();

  const imapHost   = String(formData.get("tcImapHost")   || "");
  const imapPort   = Number(formData.get("tcImapPort")   || 993);
  const imapSecure = String(formData.get("tcImapSecure") || "true") !== "false";
  const imapUser   = String(formData.get("tcImapUser")   || "");
  const imapPass   = String(formData.get("tcImapPass")   || "");
  const smtpHost   = String(formData.get("tcSmtpHost")   || "");
  const smtpPort   = Number(formData.get("tcSmtpPort")   || 465);
  const smtpSecure = String(formData.get("tcSmtpSecure") || "true") !== "false";
  const smtpUser   = String(formData.get("tcSmtpUser")   || "");
  const smtpPass   = String(formData.get("tcSmtpPass")   || "");

  if (!imapHost || !smtpHost || !imapUser || !imapPass) {
    return {
      imap: { ok: false, error: "Fehlende Pflichtfelder." },
      smtp: { ok: false, error: "Fehlende Pflichtfelder." },
    };
  }

  const [imap, smtp] = await Promise.all([
    testImap(imapHost, imapPort, imapSecure, imapUser, imapPass),
    testSmtp(smtpHost, smtpPort, smtpSecure, smtpUser || imapUser, smtpPass || imapPass),
  ]);

  return { imap, smtp };
}

async function testImap(
  host: string, port: number, secure: boolean,
  user: string, pass: string,
): Promise<ProtoResult> {
  const client = new ImapFlow({
    host, port, secure,
    auth: { user, pass },
    logger: false,
    connectionTimeout: 10_000,
    greetingTimeout: 10_000,
  });

  try {
    await client.connect();
    const lock = await client.getMailboxLock("INBOX");
    lock.release();
    return { ok: true };
  } catch (e) {
    return { ok: false, error: normalizeError(e, "IMAP") };
  } finally {
    try { await client.logout(); } catch { /* teardown */ }
  }
}

async function testSmtp(
  host: string, port: number, secure: boolean,
  user: string, pass: string,
): Promise<ProtoResult> {
  const transporter = nodemailer.createTransport({
    host, port, secure,
    auth: { user, pass },
    connectionTimeout: 10_000,
    greetingTimeout: 10_000,
    socketTimeout: 10_000,
  });

  try {
    await transporter.verify();
    return { ok: true };
  } catch (e) {
    return { ok: false, error: normalizeError(e, "SMTP") };
  } finally {
    transporter.close();
  }
}

function normalizeError(e: unknown, proto: string): string {
  const msg = e instanceof Error ? e.message : String(e);
  const m = msg.toLowerCase();
  if (m.includes("auth") || m.includes("invalid credentials") || m.includes("login failed") || m.includes("password"))
    return "Falsches Passwort oder App-Passwort";
  if (m.includes("econnrefused"))
    return `${proto}-Port nicht erreichbar (Firewall?)`;
  if (m.includes("etimedout") || m.includes("timeout"))
    return `${proto}-Server antwortet nicht`;
  if (m.includes("cert") || m.includes("ssl") || m.includes("tls"))
    return "SSL/TLS-Zertifikatsfehler";
  return msg;
}
