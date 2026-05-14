"use server";

import { revalidatePath } from "next/cache";
import { sql } from "@/lib/db/client";
import { saveCredentialSecret } from "@/lib/secrets/credential-store";
import { saveStoredSmtpAccount } from "@/mail/smtp-settings";
import { detectEmailProvider } from "@/lib/email-providers";
import { runPrimaryImapScan } from "@/mail/mail-scanner";
import { getCurrentAuth } from "@/lib/auth/current";

export type OnboardingState = {
  status: "idle" | "success" | "error";
  message: string;
  step?: number;
};

export async function completeOnboardingAction(
  _prev: OnboardingState,
  formData: FormData,
): Promise<OnboardingState> {
  void _prev;
  try {
    const email = String(formData.get("email") || "").trim();
    const password = String(formData.get("password") || "");
    const recipientEmail = String(formData.get("recipientEmail") || "").trim();
    const exportTarget = String(formData.get("exportTarget") || "kontist").trim();

    if (!email || !password) {
      return { status: "error", message: "Bitte gib E-Mail und Passwort für dein Postfach ein." };
    }
    if (!recipientEmail) {
      return { status: "error", message: "Bitte gib die E-Mail-Adresse für deinen Buchhalter ein." };
    }

    // Manual override from MailboxConnectContent (server fields pre-filled by provider picker)
    const manualImapHost = String(formData.get("imapHost") || "").trim();
    const manualSmtpHost = String(formData.get("smtpHost") || "").trim();

    let imapHost: string;
    let imapPort: number;
    let imapSecure: boolean;
    let smtpHost: string;
    let smtpPort: number;
    let smtpSecure: boolean;

    if (manualImapHost && manualSmtpHost) {
      // Provider-picker already resolved server settings
      imapHost   = manualImapHost;
      imapPort   = Number(formData.get("imapPort")  || 993);
      imapSecure = String(formData.get("imapSecure") || "true") !== "false";
      smtpHost   = manualSmtpHost;
      smtpPort   = Number(formData.get("smtpPort")  || 465);
      smtpSecure = String(formData.get("smtpSecure") || "true") !== "false";
    } else {
      // Fall back to auto-detection from e-mail domain
      const provider = detectEmailProvider(email);
      imapHost   = provider?.imapHost   ?? "";
      imapPort   = provider?.imapPort   ?? 993;
      imapSecure = provider?.imapSecure ?? true;
      smtpHost   = provider?.smtpHost   ?? "";
      smtpPort   = provider?.smtpPort   ?? 465;
      smtpSecure = provider?.smtpSecure ?? true;

      if (!imapHost || !smtpHost) {
        return {
          status: "error",
          message:
            "Wir kennen deinen Provider noch nicht automatisch — bitte wähle ihn im Postfach-Schritt aus.",
        };
      }
    }

    const auth = await getCurrentAuth();
    const organizationId = auth?.organization?.id ?? null;

    // 1) IMAP Credential + mail_account
    const imapSecretRef = await saveCredentialSecret({
      scope: "imap",
      ownerId: "primary",
      organizationId,
      label: "Primary IMAP Password",
      secret: password,
    });
    const imapCredRows = await sql<{ id: number }[]>`
      SELECT id FROM credential_refs WHERE secret_ref = ${imapSecretRef}
    `;
    const imapCredentialId = imapCredRows[0]?.id ?? null;

    const existingImapRows = await sql<{ id: number }[]>`
      SELECT id FROM mail_accounts WHERE label = 'Primary IMAP' LIMIT 1
    `;
    const existingImap = existingImapRows[0];

    if (existingImap) {
      await sql`
        UPDATE mail_accounts
        SET host = ${imapHost}, port = ${imapPort}, secure = ${imapSecure},
            username = ${email}, credential_ref_id = ${imapCredentialId},
            status = 'configured', organization_id = ${organizationId},
            updated_at = CURRENT_TIMESTAMP
        WHERE id = ${existingImap.id}
      `;
    } else {
      await sql`
        INSERT INTO mail_accounts (label, host, port, secure, username, credential_ref_id, status, organization_id)
        VALUES ('Primary IMAP', ${imapHost}, ${imapPort}, ${imapSecure}, ${email}, ${imapCredentialId}, 'configured', ${organizationId})
      `;
    }

    // 2) SMTP Credential + smtp_account JSON
    await saveCredentialSecret({
      scope: "smtp",
      ownerId: "primary",
      organizationId,
      label: "Primary SMTP Password",
      secret: password,
    });
    await saveStoredSmtpAccount("primary", {
      host: smtpHost,
      port: smtpPort,
      secure: smtpSecure,
      username: email,
      fromAddress: email,
    });

    // 3) Export Target (Kontist or Accountable, with recipient email and primary smtp)
    const exportTargetKey = exportTarget === "accountable" ? "accountable" : "kontist";
    await sql`
      UPDATE export_targets
      SET recipient_email = ${recipientEmail}, smtp_slot = 'primary', enabled = TRUE,
          updated_at = CURRENT_TIMESTAMP
      WHERE target = ${exportTargetKey}
    `;

    // 4) Trigger first scan
    runPrimaryImapScan().catch(() => {
      // Ignore — first-scan errors are visible in the activity log
    });

    revalidatePath("/");
    revalidatePath("/audit");
    revalidatePath("/einstellungen");

    return {
      status: "success",
      message: "Setup abgeschlossen. Wir holen jetzt deine Rechnungen.",
    };
  } catch (error) {
    const msg = error instanceof Error ? error.message : "Setup fehlgeschlagen.";
    return { status: "error", message: msg };
  }
}

/**
 * Inbound-only onboarding: speichert nur den Empfänger (kein IMAP).
 * Wird aufgerufen wenn der User die Inbound-Adresse statt IMAP nutzt.
 */
export async function saveRecipientOnlyAction(
  _prev: OnboardingState,
  formData: FormData,
): Promise<OnboardingState> {
  void _prev;
  try {
    const recipientEmail = String(formData.get("recipientEmail") || "").trim();
    const exportTarget = String(formData.get("exportTarget") || "kontist").trim();

    if (!recipientEmail) {
      return { status: "error", message: "Bitte gib eine Empfänger-Adresse ein." };
    }

    const exportTargetKey = exportTarget === "accountable" ? "accountable" : "kontist";
    await sql`
      UPDATE export_targets
      SET recipient_email = ${recipientEmail}, enabled = TRUE, updated_at = CURRENT_TIMESTAMP
      WHERE target = ${exportTargetKey}
    `;

    revalidatePath("/");
    revalidatePath("/einstellungen");

    return { status: "success", message: "Empfänger gespeichert." };
  } catch (error) {
    const msg = error instanceof Error ? error.message : "Speichern fehlgeschlagen.";
    return { status: "error", message: msg };
  }
}
