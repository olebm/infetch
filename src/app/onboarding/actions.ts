"use server";

import { revalidatePath } from "next/cache";
import { getDb } from "@/lib/db/client";
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

    const db = getDb();
    const auth = await getCurrentAuth();
    const organizationId = auth?.organization?.id ?? null;

    // 1) IMAP Credential + mail_account
    const imapSecretRef = await saveCredentialSecret({
      db,
      scope: "imap",
      ownerId: "primary",
      organizationId,
      label: "Primary IMAP Password",
      secret: password,
    });
    const imapCredential = db
      .prepare(`SELECT id FROM credential_refs WHERE secret_ref = ?`)
      .get(imapSecretRef) as { id: number } | undefined;

    const existingImap = db
      .prepare(`SELECT id FROM mail_accounts WHERE label = 'Primary IMAP' LIMIT 1`)
      .get() as { id: number } | undefined;

    if (existingImap) {
      db.prepare(
        `UPDATE mail_accounts
         SET host = ?, port = ?, secure = ?, username = ?, credential_ref_id = ?,
           status = 'configured', organization_id = ?, updated_at = CURRENT_TIMESTAMP
         WHERE id = ?`,
      ).run(imapHost, imapPort, imapSecure ? 1 : 0, email, imapCredential?.id ?? null, organizationId, existingImap.id);
    } else {
      db.prepare(
        `INSERT INTO mail_accounts (label, host, port, secure, username, credential_ref_id, status, organization_id)
         VALUES ('Primary IMAP', ?, ?, ?, ?, ?, 'configured', ?)`,
      ).run(imapHost, imapPort, imapSecure ? 1 : 0, email, imapCredential?.id ?? null, organizationId);
    }

    // 2) SMTP Credential + smtp_account JSON
    await saveCredentialSecret({
      db,
      scope: "smtp",
      ownerId: "primary",
      organizationId,
      label: "Primary SMTP Password",
      secret: password,
    });
    saveStoredSmtpAccount(
      "primary",
      {
        host: smtpHost,
        port: smtpPort,
        secure: smtpSecure,
        username: email,
        fromAddress: email,
      },
      db,
    );

    // 3) Export Target (Kontist or Accountable, with recipient email and primary smtp)
    const exportTargetKey = exportTarget === "accountable" ? "accountable" : "kontist";
    db.prepare(
      `UPDATE export_targets
       SET recipient_email = ?, smtp_slot = 'primary', enabled = 1, updated_at = CURRENT_TIMESTAMP
       WHERE target = ?`,
    ).run(recipientEmail, exportTargetKey);

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

    const db = getDb();
    const exportTargetKey = exportTarget === "accountable" ? "accountable" : "kontist";
    db.prepare(
      `UPDATE export_targets
       SET recipient_email = ?, enabled = 1, updated_at = CURRENT_TIMESTAMP
       WHERE target = ?`,
    ).run(recipientEmail, exportTargetKey);

    revalidatePath("/");
    revalidatePath("/einstellungen");

    return { status: "success", message: "Empfänger gespeichert." };
  } catch (error) {
    const msg = error instanceof Error ? error.message : "Speichern fehlgeschlagen.";
    return { status: "error", message: msg };
  }
}
