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

  const imapHost = String(formData.get("tcImapHost") || "");
  const imapPort = Number(formData.get("tcImapPort") || 993);
  const imapSecure = String(formData.get("tcImapSecure") || "true") !== "false";
  const imapUser = String(formData.get("tcImapUser") || "");
  const imapPass = String(formData.get("tcImapPass") || "");
  const smtpHost = String(formData.get("tcSmtpHost") || "");
  // Fallback 587/STARTTLS (nicht 465/SSL) — Port 465 wird von vielen
  // Server-Umgebungen ausgehend gesperrt (u. a. Hetzner, wo Infetch läuft).
  const smtpPort = Number(formData.get("tcSmtpPort") || 587);
  const smtpSecure = String(formData.get("tcSmtpSecure") || "false") !== "false";
  const smtpUser = String(formData.get("tcSmtpUser") || "");
  const smtpPass = String(formData.get("tcSmtpPass") || "");

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

export async function testImapOnlyConnectionAction(
  _prev: ProtoResult | null,
  formData: FormData,
): Promise<ProtoResult> {
  await requireCurrentAuth();

  const host = String(formData.get("tcImapHost") || "");
  const port = Number(formData.get("tcImapPort") || 993);
  const secure = String(formData.get("tcImapSecure") || "true") !== "false";
  const user = String(formData.get("tcImapUser") || "");
  const pass = String(formData.get("tcImapPass") || "");

  if (!host || !user || !pass) {
    return { ok: false, error: "Fehlende Pflichtfelder." };
  }
  return testImap(host, port, secure, user, pass);
}

export async function testSmtpOnlyConnectionAction(
  _prev: ProtoResult | null,
  formData: FormData,
): Promise<ProtoResult> {
  await requireCurrentAuth();

  const host = String(formData.get("tcSmtpHost") || "");
  const port = Number(formData.get("tcSmtpPort") || 587);
  const secure = String(formData.get("tcSmtpSecure") || "false") !== "false";
  const user = String(formData.get("tcSmtpUser") || "");
  const pass = String(formData.get("tcSmtpPass") || "");

  if (!host || !user || !pass) {
    return { ok: false, error: "Fehlende Pflichtfelder." };
  }
  return testSmtp(host, port, secure, user, pass);
}

async function testImap(
  host: string,
  port: number,
  secure: boolean,
  user: string,
  pass: string,
): Promise<ProtoResult> {
  const client = new ImapFlow({
    host,
    port,
    secure,
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
    return { ok: false, error: normalizeError(e) };
  } finally {
    try {
      await client.logout();
    } catch {
      /* teardown */
    }
  }
}

async function testSmtp(
  host: string,
  port: number,
  secure: boolean,
  user: string,
  pass: string,
): Promise<ProtoResult> {
  const transporter = nodemailer.createTransport({
    host,
    port,
    secure,
    auth: { user, pass },
    connectionTimeout: 10_000,
    greetingTimeout: 10_000,
    socketTimeout: 10_000,
  });

  try {
    await transporter.verify();
    return { ok: true };
  } catch (e) {
    return { ok: false, error: normalizeError(e) };
  } finally {
    transporter.close();
  }
}

function normalizeError(e: unknown): string {
  const msg = e instanceof Error ? e.message : String(e);
  const m = msg.toLowerCase();
  if (m.includes("enotfound") || m.includes("getaddrinfo"))
    return "Server-Adresse nicht gefunden — Adresse prüfen";
  if (
    m.includes("auth") ||
    m.includes("invalid credentials") ||
    m.includes("login failed") ||
    m.includes("password")
  )
    return "Falsches Passwort oder App-Passwort";
  if (m.includes("econnrefused")) return "Verbindung abgelehnt — Port prüfen";
  if (m.includes("etimedout") || m.includes("timeout"))
    return "Server antwortet nicht — Adresse oder Port prüfen";
  if (m.includes("cert") || m.includes("ssl") || m.includes("tls"))
    return "Zertifikatsfehler — Verschlüsselungs-Einstellung prüfen";
  return "Verbindung fehlgeschlagen";
}
