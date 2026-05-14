import { type NextRequest, NextResponse } from "next/server";
import { sendContactEmail } from "@/lib/mail/notify";

export const dynamic = "force-dynamic";

export async function POST(request: NextRequest): Promise<NextResponse> {
  let body: { name?: string; email?: string; message?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Ungültige Anfrage." }, { status: 400 });
  }

  const name    = body.name?.trim()    || "";
  const email   = body.email?.trim()   || "";
  const message = body.message?.trim() || "";

  if (!email || !message) {
    return NextResponse.json(
      { error: "E-Mail und Nachricht sind erforderlich." },
      { status: 400 },
    );
  }

  // Einfache E-Mail-Validierung
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return NextResponse.json({ error: "Ungültige E-Mail-Adresse." }, { status: 400 });
  }

  const ok = await sendContactEmail({
    fromName:  name || email,
    fromEmail: email,
    message,
  });

  if (!ok) {
    // Brevo nicht konfiguriert oder Fehler → trotzdem 200 (kein Key in dev ist ok)
    console.warn("[contact] E-Mail konnte nicht gesendet werden (Brevo nicht konfiguriert?)");
  }

  return NextResponse.json({ ok: true });
}
