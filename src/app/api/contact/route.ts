import { type NextRequest, NextResponse } from "next/server";
import { sendContactEmail } from "@/lib/mail/notify";
import { contactGlobalLimiter, contactIpLimiter } from "@/lib/rate-limit";

export const dynamic = "force-dynamic";

// ── Limits gegen Spam ─────────────────────────────────────────────────────────
const MAX_NAME_LENGTH = 200;
const MAX_EMAIL_LENGTH = 320; // RFC 5321
const MAX_MESSAGE_LENGTH = 5_000;

function getClientIp(request: NextRequest): string {
  // Hinter Coolify/Traefik liefert x-forwarded-for die Originalkette
  const fwd = request.headers.get("x-forwarded-for");
  if (fwd) return fwd.split(",")[0]!.trim();
  return request.headers.get("x-real-ip") ?? "unknown";
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  // SECURITY: Rate-Limits gegen Spam und E-Mail-Abuse.
  const ip = getClientIp(request);
  const ipCheck = contactIpLimiter.check(ip);
  if (!ipCheck.ok) {
    return NextResponse.json(
      { error: "Zu viele Anfragen. Bitte kurz warten." },
      {
        status: 429,
        headers: { "retry-after": String(Math.ceil((ipCheck.resetAt - Date.now()) / 1000)) },
      },
    );
  }
  const globalCheck = contactGlobalLimiter.check("global");
  if (!globalCheck.ok) {
    return NextResponse.json(
      { error: "Aktuell überlastet. Bitte später erneut versuchen." },
      { status: 429 },
    );
  }

  let body: { name?: string; email?: string; message?: string; website?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Ungültige Anfrage." }, { status: 400 });
  }

  // SECURITY: Honeypot — Bots füllen versteckte Felder oft aus.
  // Frontend setzt `website` nie; jeder Inhalt → Spam.
  if (typeof body.website === "string" && body.website.trim() !== "") {
    // Silent-drop: 200 zurückgeben damit der Bot nicht weiterprobiert
    return NextResponse.json({ ok: true });
  }

  const name = (body.name ?? "").trim().slice(0, MAX_NAME_LENGTH);
  const email = (body.email ?? "").trim().slice(0, MAX_EMAIL_LENGTH);
  const message = (body.message ?? "").trim().slice(0, MAX_MESSAGE_LENGTH);

  if (!email || !message) {
    return NextResponse.json({ error: "E-Mail und Nachricht sind erforderlich." }, { status: 400 });
  }
  if (message.length < 5) {
    return NextResponse.json({ error: "Nachricht zu kurz." }, { status: 400 });
  }

  // Einfache E-Mail-Validierung (keine Newlines → kein Header-Injection)
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || /[\r\n]/.test(email)) {
    return NextResponse.json({ error: "Ungültige E-Mail-Adresse." }, { status: 400 });
  }

  const ok = await sendContactEmail({
    fromName: name || email,
    fromEmail: email,
    message,
  });

  if (!ok) {
    // Brevo nicht konfiguriert oder Fehler → trotzdem 200 (kein Key in dev ist ok)
    console.warn("[contact] E-Mail konnte nicht gesendet werden (Brevo nicht konfiguriert?)");
  }

  return NextResponse.json({ ok: true });
}
