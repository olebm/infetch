/**
 * Ausgehende Benachrichtigungen via Resend REST API.
 *
 * Kein npm-Paket nötig — direkter fetch-Call.
 * Ohne RESEND_API_KEY werden alle Calls still übersprungen (dev-safe).
 */

import { appConfig } from "@/lib/config/env";

interface SendEmailOptions {
  to: string;
  subject: string;
  html: string;
}

async function sendEmail(opts: SendEmailOptions): Promise<boolean> {
  const { apiKey, fromEmail, fromName } = appConfig.brevo;
  if (!apiKey) return false; // kein Key → still überspringen

  try {
    const res = await fetch("https://api.brevo.com/v3/smtp/email", {
      method: "POST",
      headers: {
        "api-key": apiKey,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        sender: { name: fromName, email: fromEmail },
        to: [{ email: opts.to }],
        subject: opts.subject,
        htmlContent: opts.html,
      }),
    });
    return res.ok;
  } catch {
    return false;
  }
}

// ─── Templates ────────────────────────────────────────────────────────────────

function base(content: string): string {
  return `<!DOCTYPE html>
<html lang="de">
<head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=device-width, initial-scale=1.0" />
<style>
  body { margin: 0; background: #f6f4f0; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; }
  .wrap { max-width: 560px; margin: 40px auto; background: #fff; border: 1px solid #e5e2db; border-radius: 8px; overflow: hidden; }
  .head { background: #151a22; padding: 20px 28px; }
  .head a { color: #fff; font-size: 15px; font-weight: 600; text-decoration: none; letter-spacing: -0.02em; }
  .body { padding: 28px; color: #151a22; font-size: 14px; line-height: 1.6; }
  .body h1 { margin: 0 0 12px; font-size: 20px; font-weight: 700; letter-spacing: -0.03em; }
  .body p { margin: 0 0 16px; color: #6b6b67; }
  .btn { display: inline-block; background: #151a22; color: #fff !important; text-decoration: none; padding: 10px 20px; border-radius: 6px; font-size: 13px; font-weight: 600; margin: 8px 0 16px; }
  .foot { padding: 16px 28px; border-top: 1px solid #e5e2db; font-size: 11px; color: #a0a09a; }
</style>
</head>
<body>
<div class="wrap">
  <div class="head"><a href="https://infetch.de">Infetch</a></div>
  <div class="body">${content}</div>
  <div class="foot">Infetch · Rechnungen, die sich selbst weiterleiten. · <a href="https://infetch.de" style="color:#a0a09a">infetch.de</a></div>
</div>
</body>
</html>`;
}

// ─── Onboarding ───────────────────────────────────────────────────────────────

export async function sendOnboardingEmail(opts: {
  to: string;
  name?: string | null;
  appUrl?: string;
}): Promise<boolean> {
  const url = opts.appUrl ?? "https://app.infetch.de";
  const greeting = opts.name ? `Hallo ${opts.name.split(" ")[0]},` : "Hallo,";
  return sendEmail({
    to: opts.to,
    subject: "Willkommen bei Infetch — so geht's los",
    html: base(`
      <h1>Dein Konto ist bereit.</h1>
      <p>${greeting} schön, dass du da bist.</p>
      <p>Infetch sammelt deine Rechnungen automatisch ein und leitet sie an deine Steuersoftware weiter — ohne dass du etwas tun musst.</p>
      <p><strong>Ein Schritt fehlt noch:</strong> Verbinde dein Postfach, damit Infetch loslegen kann.</p>
      <a href="${url}/einstellungen" class="btn">Postfach verbinden →</a>
      <p style="font-size:12px;color:#a0a09a">Das dauert ungefähr 2 Minuten. Danach läuft alles automatisch.</p>
    `),
  });
}

// ─── Upgrade-Nudge ────────────────────────────────────────────────────────────

export async function sendUpgradeNudge(opts: {
  to: string;
  current: number;
  max: number;
  appUrl?: string;
}): Promise<boolean> {
  const url = opts.appUrl ?? "https://app.infetch.de";
  return sendEmail({
    to: opts.to,
    subject: `Dein Infetch-Limit ist erreicht (${opts.current}/${opts.max} Rechnungen)`,
    html: base(`
      <h1>Du hast dein Monatslimit erreicht.</h1>
      <p>Diesen Monat wurden bereits <strong>${opts.current} von ${opts.max} Rechnungen</strong> importiert.</p>
      <p>Weitere Rechnungen werden erst im nächsten Monat verarbeitet — es sei denn, du wechselst auf Pro.</p>
      <table style="width:100%;border-collapse:collapse;margin:16px 0 24px">
        <tr>
          <td style="padding:10px 0;border-bottom:1px solid #e5e2db;color:#6b6b67;font-size:13px">Rechnungen / Monat</td>
          <td style="padding:10px 0;border-bottom:1px solid #e5e2db;text-align:right;font-size:13px"><span style="text-decoration:line-through;color:#a0a09a">${opts.max}</span> → <strong>150</strong></td>
        </tr>
        <tr>
          <td style="padding:10px 0;border-bottom:1px solid #e5e2db;color:#6b6b67;font-size:13px">Speicher</td>
          <td style="padding:10px 0;border-bottom:1px solid #e5e2db;text-align:right;font-size:13px"><span style="text-decoration:line-through;color:#a0a09a">500 MB</span> → <strong>2 GB</strong></td>
        </tr>
        <tr>
          <td style="padding:10px 0;color:#6b6b67;font-size:13px">lexoffice / sevDesk Export</td>
          <td style="padding:10px 0;text-align:right;font-size:13px;color:#2d7a3a">✓ inklusive</td>
        </tr>
      </table>
      <a href="${url}/konto" class="btn">Jetzt auf Pro upgraden →</a>
    `),
  });
}

// ─── Reaktivierungs-Nudge ─────────────────────────────────────────────────────

export async function sendReactivationEmail(opts: {
  to: string;
  name?: string | null;
  daysSinceLastInvoice: number;
  appUrl?: string;
}): Promise<boolean> {
  const url = opts.appUrl ?? "https://app.infetch.de";
  const greeting = opts.name ? `Hallo ${opts.name.split(" ")[0]},` : "Hallo,";
  return sendEmail({
    to: opts.to,
    subject: "Alles ok bei Infetch?",
    html: base(`
      <h1>Wir haben dich vermisst.</h1>
      <p>${greeting} seit ${opts.daysSinceLastInvoice} Tagen hat Infetch keine neue Rechnung für dich verarbeitet.</p>
      <p>Möglicherweise ist die Verbindung zu deinem Postfach unterbrochen — das passiert manchmal nach Passwortänderungen.</p>
      <a href="${url}/einstellungen" class="btn">Verbindung prüfen →</a>
      <p style="font-size:12px;color:#a0a09a">Falls alles in Ordnung ist und du gerade einfach keine Rechnungen hattest, kannst du diese Mail ignorieren.</p>
    `),
  });
}

// ─── Review-Benachrichtigung ──────────────────────────────────────────────────

export async function sendReviewNotification(opts: {
  to: string;
  vendorName: string;
  invoiceId: number;
  appUrl?: string;
}): Promise<boolean> {
  const url = `${opts.appUrl ?? "https://app.infetch.de"}/posteingang/${opts.invoiceId}`;
  return sendEmail({
    to: opts.to,
    subject: `Rechnung prüfen: ${opts.vendorName}`,
    html: base(`
      <h1>Eine Rechnung wartet auf dich.</h1>
      <p>Infetch hat eine Rechnung von <strong>${opts.vendorName}</strong> erkannt, ist sich aber nicht sicher genug, um sie automatisch weiterzuleiten.</p>
      <p>Ein kurzer Blick reicht — meist unter 30 Sekunden.</p>
      <a href="${url}" class="btn">Rechnung prüfen →</a>
      <p style="font-size:12px">Du erhältst diese Mail, weil der Auto-Pilot eine manuelle Prüfung angefordert hat.</p>
    `),
  });
}

// ─── Monatlicher Report ───────────────────────────────────────────────────────

const MONTHS_DE = [
  "Januar", "Februar", "März", "April", "Mai", "Juni",
  "Juli", "August", "September", "Oktober", "November", "Dezember",
];

function formatEur(amount: number): string {
  return amount.toLocaleString("de-DE", {
    style: "currency",
    currency: "EUR",
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  });
}

export async function sendMonthlyReport(opts: {
  to: string;
  month: string; // "YYYY-MM"
  sent: number;
  sentAuto: number;
  sentManual: number;
  sumGross: number;
  prevSent: number;
  prevSumGross: number;
  pending: number;
  topVendors: Array<{ name: string; count: number; sumGross: number }>;
  appUrl?: string;
}): Promise<boolean> {
  const { month, sent, sentAuto, sentManual, sumGross, prevSent, prevSumGross, pending, topVendors } = opts;
  const base_url = opts.appUrl ?? "https://app.infetch.de";

  const [yearStr, mStr] = month.split("-");
  const monthName = MONTHS_DE[parseInt(mStr ?? "1", 10) - 1] ?? month;
  const year = yearStr ?? "";

  const deltaCount = prevSent > 0 ? Math.round(((sent - prevSent) / prevSent) * 100) : null;
  const deltaAmount = prevSumGross > 0 ? Math.round(((sumGross - prevSumGross) / prevSumGross) * 100) : null;

  const deltaCountHtml = deltaCount !== null
    ? `<span style="color:${deltaCount >= 0 ? "#2d7a3a" : "#c0392b"};font-size:12px;margin-left:8px">${deltaCount >= 0 ? "+" : ""}${deltaCount}%</span>`
    : "";
  const deltaAmountHtml = deltaAmount !== null
    ? `<span style="color:${deltaAmount >= 0 ? "#2d7a3a" : "#c0392b"};font-size:12px;margin-left:8px">${deltaAmount >= 0 ? "+" : ""}${deltaAmount}%</span>`
    : "";

  const vendorRowsHtml = topVendors.length > 0
    ? topVendors.map((v, i) => `
        <tr>
          <td style="padding:10px 0;border-bottom:1px solid #e5e2db;color:#6b6b67;font-size:13px">${i + 1}. ${v.name}</td>
          <td style="padding:10px 0;border-bottom:1px solid #e5e2db;text-align:right;font-size:13px;font-variant-numeric:tabular-nums">${v.count}×</td>
          <td style="padding:10px 0;border-bottom:1px solid #e5e2db;text-align:right;font-size:13px;font-variant-numeric:tabular-nums">${formatEur(v.sumGross)}</td>
        </tr>`).join("")
    : "";

  return sendEmail({
    to: opts.to,
    subject: `Infetch ${monthName} ${year}: ${sent} Rechnung${sent !== 1 ? "en" : ""} · ${formatEur(sumGross)}`,
    html: base(`
      <h1>${monthName} ${year}</h1>
      <p>Hier ist, was Infetch letzten Monat für dich erledigt hat.</p>
      <table style="width:100%;border-collapse:collapse;margin:0 0 20px">
        <tr>
          <td style="padding:12px 0;border-bottom:1px solid #e5e2db;color:#6b6b67;font-size:13px">Rechnungen weitergeleitet</td>
          <td style="padding:12px 0;border-bottom:1px solid #e5e2db;text-align:right;font-weight:700;font-size:18px;font-variant-numeric:tabular-nums">${sent}${deltaCountHtml}</td>
        </tr>
        <tr>
          <td style="padding:12px 0;border-bottom:1px solid #e5e2db;color:#6b6b67;font-size:13px">Gesamtbetrag</td>
          <td style="padding:12px 0;border-bottom:1px solid #e5e2db;text-align:right;font-weight:700;font-size:18px;font-variant-numeric:tabular-nums">${formatEur(sumGross)}${deltaAmountHtml}</td>
        </tr>
        <tr>
          <td style="padding:12px 0;border-bottom:1px solid #e5e2db;color:#6b6b67;font-size:13px">Automatisch</td>
          <td style="padding:12px 0;border-bottom:1px solid #e5e2db;text-align:right;font-size:14px;font-variant-numeric:tabular-nums">${sentAuto}</td>
        </tr>
        <tr>
          <td style="padding:12px 0;border-bottom:${pending > 0 ? "1px solid #e5e2db" : "none"};color:#6b6b67;font-size:13px">Manuell bestätigt</td>
          <td style="padding:12px 0;border-bottom:${pending > 0 ? "1px solid #e5e2db" : "none"};text-align:right;font-size:14px;font-variant-numeric:tabular-nums">${sentManual}</td>
        </tr>
        ${pending > 0 ? `<tr>
          <td style="padding:12px 0;color:#6b6b67;font-size:13px">Noch offen</td>
          <td style="padding:12px 0;text-align:right;font-weight:700;font-size:14px;color:#e07000;font-variant-numeric:tabular-nums">${pending}</td>
        </tr>` : ""}
      </table>
      ${vendorRowsHtml ? `
        <p style="font-size:12px;color:#a0a09a;margin:0 0 8px;text-transform:uppercase;letter-spacing:0.06em">Top-Anbieter</p>
        <table style="width:100%;border-collapse:collapse;margin:0 0 20px">
          ${vendorRowsHtml}
        </table>` : ""}
      ${pending > 0
        ? `<a href="${base_url}/audit?tab=review" class="btn">${pending} offene Rechnung${pending !== 1 ? "en" : ""} prüfen →</a>`
        : `<a href="${base_url}" class="btn">Zur Übersicht →</a>`
      }
    `),
  });
}

// ─── Wöchentlicher Digest ─────────────────────────────────────────────────────

export async function sendWeeklyDigest(opts: {
  to: string;
  sent: number;
  reviewed: number;
  pending: number;
  appUrl?: string;
}): Promise<boolean> {
  const base_url = opts.appUrl ?? "https://app.infetch.de";
  const { sent, reviewed, pending } = opts;

  if (sent === 0 && reviewed === 0 && pending === 0) return false; // nichts zu berichten

  return sendEmail({
    to: opts.to,
    subject: `Deine Woche: ${sent} Rechnung${sent !== 1 ? "en" : ""} weitergeleitet`,
    html: base(`
      <h1>Wochenzusammenfassung</h1>
      <p>Hier ist, was Infetch diese Woche für dich erledigt hat:</p>
      <table style="width:100%;border-collapse:collapse;margin:0 0 20px">
        <tr>
          <td style="padding:12px 0;border-bottom:1px solid #e5e2db;color:#6b6b67;font-size:13px">Automatisch weitergeleitet</td>
          <td style="padding:12px 0;border-bottom:1px solid #e5e2db;text-align:right;font-weight:700;font-size:18px;font-variant-numeric:tabular-nums">${sent}</td>
        </tr>
        <tr>
          <td style="padding:12px 0;border-bottom:1px solid #e5e2db;color:#6b6b67;font-size:13px">Manuell bestätigt</td>
          <td style="padding:12px 0;border-bottom:1px solid #e5e2db;text-align:right;font-weight:700;font-size:18px;font-variant-numeric:tabular-nums">${reviewed}</td>
        </tr>
        ${pending > 0 ? `<tr>
          <td style="padding:12px 0;color:#6b6b67;font-size:13px">Noch offen</td>
          <td style="padding:12px 0;text-align:right;font-weight:700;font-size:18px;color:#e07000;font-variant-numeric:tabular-nums">${pending}</td>
        </tr>` : ""}
      </table>
      ${pending > 0
        ? `<a href="${base_url}/posteingang" class="btn">${pending} offene Rechnung${pending !== 1 ? "en" : ""} prüfen →</a>`
        : `<a href="${base_url}" class="btn">Zur Übersicht →</a>`
      }
    `),
  });
}
