import crypto from "node:crypto";
import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { appConfig } from "@/lib/config/env";
import {
  findInboundAddressByLocalPart,
  recordInboundDelivery,
} from "@/mail/inbound-addresses";
import { importPdfBuffer } from "@/invoices/import-pipeline";
import { recordSyncEvent } from "@/lib/db/events";
import { getDb } from "@/lib/db/client";
import { inboundGlobalLimiter, inboundIpLimiter } from "@/lib/rate-limit";

// Resend Inbound Webhook Payload (vereinfachte Form fuer unsere Bedarfe).
const attachmentSchema = z.object({
  filename: z.string(),
  content_type: z.string().optional(),
  content: z.string(), // base64
});

const payloadSchema = z.object({
  from: z.union([z.string(), z.object({ email: z.string() })]).optional(),
  to: z.union([z.string(), z.array(z.string())]).optional(),
  subject: z.string().optional(),
  // SECURITY (INFETCH-94): Max. 20 Attachments — jeder Anhang triggert einen KI-Call
  attachments: z.array(attachmentSchema).max(20).optional().default([]),
});

function extractRecipientLocalPart(raw: unknown): string | null {
  if (!raw) return null;
  const candidates: string[] = [];
  if (typeof raw === "string") candidates.push(raw);
  if (Array.isArray(raw)) {
    for (const item of raw) {
      if (typeof item === "string") candidates.push(item);
    }
  }
  const expectedDomain = appConfig.resendInbound.domain.toLowerCase();
  for (const candidate of candidates) {
    const match = candidate.match(/<?\s*([\w.+-]+)@([\w.-]+)\s*>?$/i);
    if (!match) continue;
    if (match[2].toLowerCase() !== expectedDomain) continue;
    return match[1].toLowerCase();
  }
  return null;
}

function verifyWebhookSignature(request: NextRequest, body: string): boolean {
  const secret = appConfig.resendInbound.webhookSecret;

  // SECURITY (INFETCH-88): In Production MUSS das Secret konfiguriert sein.
  // Ohne Secret ist der Endpunkt für beliebige Requests offen (Invoice Stuffing, KI-Cost-Inflation).
  if (!secret) {
    return (process.env.NODE_ENV as string) !== "production"; // Dev: erlaubt, Production: verweigert
  }

  // Resend nutzt typischerweise eine HMAC-SHA256-Signatur im Header.
  // Header-Name ist nicht offiziell stabilisiert — pruefe gaengige Varianten.
  const headerValue =
    request.headers.get("svix-signature") ||
    request.headers.get("resend-signature") ||
    request.headers.get("x-resend-signature") ||
    "";
  if (!headerValue) return false;

  const expectedHex = crypto.createHmac("sha256", secret).update(body).digest("hex");
  const expectedBuf = Buffer.from(expectedHex);

  // Header kann mehrere Werte enthalten (z.B. "v1,xxxx").
  // SECURITY: timingSafeEqual statt .includes() — verhindert Timing-Oracle.
  const parts = headerValue.toLowerCase().split(/[,\s]+/);
  return parts.some((part) => {
    const partBuf = Buffer.from(part);
    if (partBuf.length !== expectedBuf.length) return false;
    return crypto.timingSafeEqual(partBuf, expectedBuf);
  });
}

// SECURITY (INFETCH-94): Max. Payload-Größe — base64-kodierte PDFs können groß sein,
// aber >10 MB ist ungewöhnlich und deutet auf Missbrauch oder Fehlkonfiguration hin.
const MAX_BODY_BYTES = 10 * 1024 * 1024; // 10 MB

export async function POST(request: NextRequest) {
  const bodyText = await request.text();

  // Payload-Größencheck vor allem anderen (billiger als Signatur-Berechnung)
  if (Buffer.byteLength(bodyText, "utf8") > MAX_BODY_BYTES) {
    return NextResponse.json({ error: "payload_too_large" }, { status: 413 });
  }

  if (!verifyWebhookSignature(request, bodyText)) {
    return NextResponse.json({ error: "invalid_signature" }, { status: 401 });
  }

  // SECURITY (INFETCH-94): Rate-Limiting nach erfolgreicher Signatur-Prüfung.
  // Nur authentifizierte Requests zählen → Angreifer ohne Secret kommen nicht bis hierher.
  // Globales Limit: 60/min  |  Pro-IP-Limit: 10/min
  {
    const ip =
      request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ??
      request.headers.get("x-real-ip") ??
      "unknown";

    const globalResult = inboundGlobalLimiter.check("global");
    const ipResult     = inboundIpLimiter.check(ip);

    if (!globalResult.ok || !ipResult.ok) {
      const resetAt      = Math.max(globalResult.resetAt, ipResult.resetAt);
      const retryAfter   = Math.ceil((resetAt - Date.now()) / 1000);
      const limitedBy    = !globalResult.ok ? "global" : "ip";
      return NextResponse.json(
        { error: "rate_limited", limitedBy },
        { status: 429, headers: { "Retry-After": String(retryAfter) } },
      );
    }
  }

  let payload: z.infer<typeof payloadSchema>;
  try {
    payload = payloadSchema.parse(JSON.parse(bodyText));
  } catch (error) {
    return NextResponse.json(
      { error: "bad_request", message: error instanceof Error ? error.message : "Invalid payload" },
      { status: 400 },
    );
  }

  const localPart = extractRecipientLocalPart(payload.to);
  if (!localPart) {
    return NextResponse.json({ error: "no_recipient_match" }, { status: 422 });
  }

  const db = getDb();
  const address = findInboundAddressByLocalPart(localPart, db);
  if (!address) {
    return NextResponse.json({ error: "address_not_found" }, { status: 404 });
  }

  const fromAddress =
    typeof payload.from === "string"
      ? payload.from
      : payload.from && "email" in payload.from
        ? payload.from.email
        : "unknown";

  const pdfAttachments = (payload.attachments ?? []).filter((att) => {
    const filename = att.filename.toLowerCase();
    const mime = (att.content_type || "").toLowerCase();
    return filename.endsWith(".pdf") || mime === "application/pdf";
  });

  if (pdfAttachments.length === 0) {
    recordSyncEvent(db, {
      level: "info",
      eventType: "resend_inbound_no_pdf",
      message: `Mail von ${fromAddress} ohne PDF-Anhang ignoriert.`,
      metadata: { subject: payload.subject ?? null, addressId: address.id },
    });
    return NextResponse.json({ ok: true, imported: 0, skipped: "no_pdf" });
  }

  let imported = 0;
  const results: Array<{ filename: string; status: string; message: string }> = [];

  for (const attachment of pdfAttachments) {
    try {
      const buffer = Buffer.from(attachment.content, "base64");
      const result = await importPdfBuffer({
        buffer,
        originalFilename: attachment.filename,
        mimeType: attachment.content_type || "application/pdf",
        sourceType: "mail",
        sourceRefId: `resend:${address.id}`,
        db,
      });
      results.push({
        filename: attachment.filename,
        status: result.status,
        message: result.message,
      });
      if (result.ok && result.status === "imported") imported += 1;
    } catch (error) {
      const message = error instanceof Error ? error.message : "import failed";
      results.push({ filename: attachment.filename, status: "failed", message });
    }
  }

  recordInboundDelivery(address.id, db);

  recordSyncEvent(db, {
    level: "info",
    eventType: "resend_inbound_received",
    message: `Resend-Inbound: ${imported} PDF(s) importiert von ${fromAddress}.`,
    metadata: {
      from: fromAddress,
      subject: payload.subject ?? null,
      addressId: address.id,
      organizationId: address.organizationId,
      attachmentCount: pdfAttachments.length,
      results,
    },
  });

  return NextResponse.json({
    ok: true,
    imported,
    total: pdfAttachments.length,
    results,
  });
}
