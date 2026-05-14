"use server";

import { getCurrentAuth } from "@/lib/auth/current";
import { appConfig } from "@/lib/config/env";

export type SupportCategory =
  | "invoice_not_recognized"
  | "mail_connection"
  | "export_problem"
  | "account"
  | "feature_request"
  | "other";

export type SupportActionState = {
  status: "idle" | "success" | "error";
  message: string;
};

const CATEGORY_LABELS: Record<SupportCategory, string> = {
  invoice_not_recognized: "Rechnung nicht erkannt",
  mail_connection: "Mail-Verbindung gestört",
  export_problem: "Export-Problem",
  account: "Konto & Zugang",
  feature_request: "Feature-Wunsch",
  other: "Sonstiges",
};

export async function submitSupportRequestAction(
  _prev: SupportActionState,
  formData: FormData,
): Promise<SupportActionState> {
  const auth = await getCurrentAuth();

  const category = (formData.get("category") as SupportCategory | null) ?? "other";
  const description = (formData.get("description") as string | null)?.trim() ?? "";
  const replyEmail = (formData.get("email") as string | null)?.trim() ?? auth?.user?.email ?? "";

  if (!description || description.length < 10) {
    return {
      status: "error",
      message: "Bitte beschreibe das Problem kurz (mindestens 10 Zeichen).",
    };
  }

  const categoryLabel = CATEGORY_LABELS[category] ?? category;
  const orgInfo = auth?.organization
    ? `${auth.organization.name} (${auth.organization.id})`
    : "Keine Org";
  const userInfo = auth?.user ? `${auth.user.email} (${auth.user.id})` : replyEmail;

  const subject = `[Infetch Support] ${categoryLabel} — ${replyEmail}`;
  const htmlBody = `
    <p><strong>Kategorie:</strong> ${categoryLabel}</p>
    <p><strong>Von:</strong> ${userInfo}</p>
    <p><strong>Organisation:</strong> ${orgInfo}</p>
    <hr/>
    <p style="white-space:pre-wrap">${description.replace(/</g, "&lt;").replace(/>/g, "&gt;")}</p>
  `;

  const { apiKey, fromEmail, fromName } = appConfig.brevo;

  // Versand via Brevo wenn konfiguriert, sonst Fallback auf Konsole (Dev)
  if (apiKey) {
    try {
      const res = await fetch("https://api.brevo.com/v3/smtp/email", {
        method: "POST",
        headers: {
          "api-key": apiKey,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          sender: { name: fromName, email: fromEmail },
          to: [{ email: "support@infetch.de" }],
          replyTo: replyEmail ? { email: replyEmail } : undefined,
          subject,
          htmlContent: htmlBody,
        }),
      });
      if (!res.ok) {
        const err = await res.text();
        console.error("[supportAction] Brevo error:", err);
        return { status: "error", message: "Versand fehlgeschlagen. Bitte versuche es erneut." };
      }
    } catch (e) {
      console.error("[supportAction]", e);
      return { status: "error", message: "Netzwerkfehler. Bitte versuche es erneut." };
    }
  } else {
    // Dev: nur in Konsole loggen
    console.log("[supportAction] (no RESEND_API_KEY)", { subject, replyEmail, description });
  }

  return {
    status: "success",
    message: "Danke! Wir melden uns innerhalb von 24 Stunden.",
  };
}
