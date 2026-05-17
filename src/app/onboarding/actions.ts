"use server";

import { revalidatePath } from "next/cache";
import { sql } from "@/lib/db/client";
import { saveCredentialSecret } from "@/lib/secrets/credential-store";
import { saveStoredSmtpAccount } from "@/mail/smtp-settings";
import { getProviderFromEmail } from "@/lib/mail-providers";
import { runPrimaryImapScan } from "@/mail/mail-scanner";
import { verifyImapAccountConnection } from "@/mail/imap-client";
import { verifySmtpAccountConnection } from "@/mail/smtp-client";
import { requireCurrentAuth } from "@/lib/auth/current";

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

  const auth = await requireCurrentAuth();

  try {
    const email = String(formData.get("email") || "").trim();
    const password = String(formData.get("password") || "");
    // SMTP may use separate credentials (e.g. relay account); fall back to IMAP credentials
    const smtpEmail    = String(formData.get("smtpEmail")    || "").trim() || email;
    const smtpPassword = String(formData.get("smtpPassword") || "")        || password;
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
      const provider = getProviderFromEmail(email);
      imapHost   = provider?.imap.host   ?? "";
      imapPort   = provider?.imap.port   ?? 993;
      imapSecure = provider?.imap.secure ?? true;
      smtpHost   = provider?.smtp.host   ?? "";
      smtpPort   = provider?.smtp.port   ?? 465;
      smtpSecure = provider?.smtp.secure ?? true;

      if (!imapHost || !smtpHost) {
        return {
          status: "error",
          message:
            "Wir kennen deinen Provider noch nicht automatisch — bitte wähle ihn im Postfach-Schritt aus.",
        };
      }
    }

    // SECURITY: Onboarding speichert IMAP/SMTP-Credentials — Auth-Pflicht
    // UND aktive Organisation. Sonst landen Datensätze mit organization_id=NULL
    // in mail_accounts (über den service_role-Client, RLS bypass), was den
    // unique-org-scope von Migration 0012 umgehen würde.
    if (!auth.organization) {
      return {
        status: "error",
        message: "Keine aktive Organisation. Bitte erst Account einrichten.",
      };
    }
    const organizationId = auth.organization.id;

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

    // SECURITY: Lookup scoped auf Organisation — sonst überschreibt
    // ein neuer Onboarding-Lauf den Datensatz einer anderen Org.
    const existingImapRows = await sql<{ id: number }[]>`
      SELECT id FROM mail_accounts
      WHERE label = 'Primary IMAP'
        AND (organization_id = ${organizationId}
             OR (${organizationId}::text IS NULL AND organization_id IS NULL))
      LIMIT 1
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

    // 2) SMTP Credential + smtp_account JSON (may use separate account from IMAP)
    await saveCredentialSecret({
      scope: "smtp",
      ownerId: "primary",
      organizationId,
      label: "Primary SMTP Password",
      secret: smtpPassword,
    });
    await saveStoredSmtpAccount("primary", {
      host: smtpHost,
      port: smtpPort,
      secure: smtpSecure,
      username: smtpEmail,
      fromAddress: smtpEmail,
    });

    // 3) Export Target (Kontist or Accountable) — per Org gescoped (Migration 0013).
    //    Default-Row wird beim Anlegen der Org geseeded (createUserWithDefaultOrg);
    //    Onboarding setzt nur die Konfigurationsfelder.
    const exportTargetKey = exportTarget === "accountable" ? "accountable" : "kontist";
    const exportLabel = exportTargetKey === "accountable" ? "Accountable" : "Kontist";
    await sql`
      INSERT INTO export_targets (organization_id, target, label, recipient_email, smtp_slot, enabled)
      VALUES (${organizationId}, ${exportTargetKey}, ${exportLabel}, ${recipientEmail}, 'primary', TRUE)
      ON CONFLICT (organization_id, target) DO UPDATE SET
        recipient_email = excluded.recipient_email,
        smtp_slot = 'primary',
        enabled = TRUE,
        updated_at = CURRENT_TIMESTAMP
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

export async function verifyOnboardingConnectionAction(): Promise<{ ok: boolean; error?: string }> {
  const auth = await requireCurrentAuth();
  const orgId = auth.organization?.id ?? null;
  try {
    await verifyImapAccountConnection("primary", orgId);
    await verifySmtpAccountConnection("primary", orgId);
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Verbindung fehlgeschlagen." };
  }
}

