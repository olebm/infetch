"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { sql } from "@/lib/db/client";
import { IMAP_MAIL_ACCOUNT_SLOTS } from "@/mail/imap-account-slots";
import { SMTP_ACCOUNT_SLOTS } from "@/mail/smtp-account-slots";
import { saveStoredSmtpAccount } from "@/mail/smtp-settings";
import { saveCredentialSecret, hasStoredCredentialRef } from "@/lib/secrets/credential-store";
import { verifyMistralConnection } from "@/ai/mistral-client";
import { verifyImapAccountConnection } from "@/mail/imap-client";
import { verifySmtpAccountConnection } from "@/mail/smtp-client";
import { runPrimaryImapScan } from "@/mail/mail-scanner";
import { saveExportTarget } from "@/exports/export-pipeline";
import {
  deleteAutoApprovalRule,
  upsertAutoApprovalRule,
  upsertIntegrationTarget,
  disableIntegrationTarget,
  markIntegrationVerified,
  type IntegrationProvider,
} from "@/lib/db/queries";
import { writeJsonSetting } from "@/lib/db/settings-store";
import { verifyLexofficeConnection, LexofficeApiError } from "@/lib/integrations/lexoffice-client";
import { verifySevdeskConnection, SevdeskApiError } from "@/lib/integrations/sevdesk-client";
import { getCurrentAuth, requireCurrentAuth } from "@/lib/auth/current";
import { updateUserProfile, invalidateAllOtherSessions } from "@/lib/auth/session";
import { canExport } from "@/lib/tier";
import {
  createSupabaseAdminClient,
  createSupabaseServerClient,
} from "@/lib/supabase/server";
import { cancelSubscriptionImmediately } from "@/lib/stripe";
import { BUCKETS, deleteFromStorage } from "@/lib/supabase/storage";

export type CredentialFormState = {
  status: "idle" | "success" | "error";
  message: string;
};

export async function saveMistralCredentialAction(
  _previousState: CredentialFormState,
  formData: FormData,
): Promise<CredentialFormState> {
  void _previousState;

  const auth = await requireCurrentAuth();

  try {
    const apiKey = String(formData.get("mistralApiKey") || "").trim();
    if (apiKey.length < 16) {
      return { status: "error", message: "Bitte einen gültigen Mistral API Key eingeben." };
    }

    await saveCredentialSecret({
      scope: "mistral",
      ownerId: "default",
      organizationId: auth.organization?.id ?? null,
      label: "Mistral API Key",
      secret: apiKey,
    });

    revalidatePath("/");
    revalidatePath("/einstellungen");
    return { status: "success", message: "Mistral API Key wurde im Secret Store gespeichert." };
  } catch (error) {
    return { status: "error", message: sanitizeCredentialError(error) };
  }
}

export async function saveImapCredentialAction(
  _previousState: CredentialFormState,
  formData: FormData,
): Promise<CredentialFormState> {
  void _previousState;

  const auth = await requireCurrentAuth();

  try {
    const slotParam = String(formData.get("imapSlot") || "primary").trim();
    const slot = IMAP_MAIL_ACCOUNT_SLOTS.find((s) => s.ownerId === slotParam);
    if (!slot) {
      return { status: "error", message: "Ungültiges IMAP-Konto." };
    }

    const host = String(formData.get("imapHost") || "").trim();
    const username = String(formData.get("imapUser") || "").trim();
    const password = String(formData.get("imapPassword") || "");
    const port = Number(formData.get("imapPort") || 993);
    const secure = formData.get("imapSecure") === "on";

    if (!host || !username || !Number.isInteger(port) || port <= 0 || port > 65535) {
      return { status: "error", message: "Bitte Host, Port und User vollständig ausfüllen." };
    }

    const organizationId = auth.organization?.id ?? null;
    const credentialLabel = slot.label === "Primary IMAP" ? "Primary IMAP Password" : "Secondary IMAP Password";

    let credentialRefId: number | null = null;

    if (password.trim()) {
      const secretRef = await saveCredentialSecret({
        scope: "imap",
        ownerId: slot.ownerId,
        organizationId,
        label: credentialLabel,
        secret: password,
      });
      const credRows = await sql<{ id: number }[]>`
        SELECT id FROM credential_refs WHERE secret_ref = ${secretRef}
      `;
      credentialRefId = credRows[0]?.id ?? null;
    } else if (!(await hasStoredCredentialRef("imap", slot.ownerId, organizationId))) {
      return { status: "error", message: "Bitte ein Passwort eingeben (noch kein Passwort gespeichert)." };
    } else {
      // SECURITY: Lookup scoped auf Organisation — verhindert Cross-Tenant-Match
      const existingRows = await sql<{ credential_ref_id: number | null }[]>`
        SELECT credential_ref_id FROM mail_accounts
        WHERE label = ${slot.label}
          AND (organization_id = ${organizationId}
               OR (${organizationId}::text IS NULL AND organization_id IS NULL))
        LIMIT 1
      `;
      credentialRefId = existingRows[0]?.credential_ref_id ?? null;
    }

    // SECURITY: Lookup scoped auf Organisation. Ohne Scope hätte Org B einen
    // Datensatz mit label='Primary IMAP' von Org A überschrieben.
    const existingAccountRows = await sql<{ id: number }[]>`
      SELECT id FROM mail_accounts
      WHERE label = ${slot.label}
        AND (organization_id = ${organizationId}
             OR (${organizationId}::text IS NULL AND organization_id IS NULL))
      LIMIT 1
    `;
    const existingAccount = existingAccountRows[0];

    if (existingAccount) {
      await sql`
        UPDATE mail_accounts
        SET host = ${host}, port = ${port}, secure = ${secure}, username = ${username},
            credential_ref_id = ${credentialRefId},
            status = 'configured', organization_id = ${organizationId},
            updated_at = CURRENT_TIMESTAMP
        WHERE id = ${existingAccount.id}
      `;
    } else {
      await sql`
        INSERT INTO mail_accounts (label, host, port, secure, username, credential_ref_id, status, organization_id)
        VALUES (${slot.label}, ${host}, ${port}, ${secure}, ${username}, ${credentialRefId}, 'configured', ${organizationId})
      `;
    }

    revalidatePath("/");
    revalidatePath("/einstellungen");
    return {
      status: "success",
      message: `${slot.label}: Zugang wurde gespeichert. Das Passwort liegt im Secret Store.`,
    };
  } catch (error) {
    return { status: "error", message: sanitizeCredentialError(error) };
  }
}

export async function saveSmtpCredentialAction(
  _previousState: CredentialFormState,
  formData: FormData,
): Promise<CredentialFormState> {
  void _previousState;

  const auth = await requireCurrentAuth();

  try {
    const slotParam = String(formData.get("smtpSlot") || "primary").trim();
    const slot = SMTP_ACCOUNT_SLOTS.find((s) => s.ownerId === slotParam);
    if (!slot) {
      return { status: "error", message: "Ungültiges SMTP-Konto." };
    }

    const host = String(formData.get("smtpHost") || "").trim();
    const username = String(formData.get("smtpUser") || "").trim();
    const fromAddress = String(formData.get("smtpFromAddress") || "").trim();
    const password = String(formData.get("smtpPassword") || "");
    const port = Number(formData.get("smtpPort") || 587);
    const secure = formData.get("smtpSecure") === "on";

    if (!host || !username || !fromAddress || !Number.isInteger(port) || port <= 0 || port > 65535) {
      return { status: "error", message: "Bitte Host, Port, User und Absenderadresse vollständig ausfüllen." };
    }

    const organizationId = auth.organization?.id ?? null;

    if (password.trim()) {
      await saveCredentialSecret({
        scope: "smtp",
        ownerId: slot.ownerId,
        organizationId,
        label: `${slot.label} Password`,
        secret: password,
      });
    } else if (!(await hasStoredCredentialRef("smtp", slot.ownerId, organizationId))) {
      return { status: "error", message: "Bitte ein Passwort eingeben (noch kein Passwort gespeichert)." };
    }

    await saveStoredSmtpAccount(slot.ownerId, { host, port, secure, username, fromAddress });

    revalidatePath("/");
    revalidatePath("/einstellungen");
    return {
      status: "success",
      message: `${slot.label}: Zugang gespeichert. Das Passwort liegt im Secret Store.`,
    };
  } catch (error) {
    return { status: "error", message: sanitizeCredentialError(error) };
  }
}

/**
 * Kombinierte Mailbox-Action: speichert IMAP + SMTP in einem Schritt.
 * Nimmt E-Mail + Passwort plus vorausgefüllte (hidden) Server-Felder vom Provider-Picker.
 */
export async function saveMailboxCredentialsAction(
  _previousState: CredentialFormState,
  formData: FormData,
): Promise<CredentialFormState> {
  void _previousState;

  const auth = await requireCurrentAuth();

  try {
    const mailSlot   = (String(formData.get("mailSlot") || "primary") === "secondary" ? "secondary" : "primary") as "primary" | "secondary";
    const slotLabel  = mailSlot === "secondary" ? "Secondary IMAP" : "Primary IMAP";
    const slotPwd    = mailSlot === "secondary" ? "Secondary IMAP Password" : "Primary IMAP Password";
    const slotSmtpPwd = mailSlot === "secondary" ? "Secondary SMTP Password" : "Primary SMTP Password";

    const email    = String(formData.get("mailEmail")    || "").trim();
    const password = String(formData.get("mailPassword") || "");
    // Separate SMTP credentials (optional — fall back to IMAP credentials)
    const smtpEmail    = String(formData.get("smtpEmail")    || "").trim() || email;
    const smtpPassword = String(formData.get("smtpPassword") || "")        || password;
    const imapHost  = String(formData.get("imapHost")  || "").trim();
    const imapPort  = Number(formData.get("imapPort")  || 993);
    const imapSecure = String(formData.get("imapSecure") || "true") !== "false";
    const smtpHost  = String(formData.get("smtpHost")  || "").trim();
    const smtpPort  = Number(formData.get("smtpPort")  || 465);
    const smtpSecure = String(formData.get("smtpSecure") || "true") !== "false";

    if (!email) return { status: "error", message: "Bitte eine E-Mail-Adresse eingeben." };
    if (!imapHost || !smtpHost) return { status: "error", message: "Server-Daten fehlen — bitte einen Anbieter wählen." };
    if (!Number.isInteger(imapPort) || imapPort <= 0) return { status: "error", message: "Ungültiger IMAP-Port." };
    if (!Number.isInteger(smtpPort) || smtpPort <= 0) return { status: "error", message: "Ungültiger SMTP-Port." };

    const organizationId = auth.organization?.id ?? null;

    // ── 1) IMAP credential + mail_account ─────────────────────────────────────
    let imapCredRefId: number | null = null;
    if (password.trim()) {
      const secretRef = await saveCredentialSecret({
        scope: "imap",
        ownerId: mailSlot,
        organizationId,
        label: slotPwd,
        secret: password,
      });
      const credRows = await sql<{ id: number }[]>`
        SELECT id FROM credential_refs WHERE secret_ref = ${secretRef}
      `;
      imapCredRefId = credRows[0]?.id ?? null;
    } else if (!(await hasStoredCredentialRef("imap", mailSlot, organizationId))) {
      return { status: "error", message: "Bitte ein Passwort eingeben (noch kein Passwort gespeichert)." };
    } else {
      // SECURITY: Lookup scoped auf Organisation
      const existingRows = await sql<{ credential_ref_id: number | null }[]>`
        SELECT credential_ref_id FROM mail_accounts
        WHERE label = ${slotLabel}
          AND (organization_id = ${organizationId}
               OR (${organizationId}::text IS NULL AND organization_id IS NULL))
        LIMIT 1
      `;
      imapCredRefId = existingRows[0]?.credential_ref_id ?? null;
    }

    // SECURITY: Lookup scoped auf Organisation
    const existingImapRows = await sql<{ id: number }[]>`
      SELECT id FROM mail_accounts
      WHERE label = ${slotLabel}
        AND (organization_id = ${organizationId}
             OR (${organizationId}::text IS NULL AND organization_id IS NULL))
      LIMIT 1
    `;
    const existingImap = existingImapRows[0];

    if (existingImap) {
      await sql`
        UPDATE mail_accounts
        SET host = ${imapHost}, port = ${imapPort}, secure = ${imapSecure}, username = ${email},
            credential_ref_id = ${imapCredRefId},
            status = 'configured', organization_id = ${organizationId},
            updated_at = CURRENT_TIMESTAMP
        WHERE id = ${existingImap.id}
      `;
    } else {
      await sql`
        INSERT INTO mail_accounts (label, host, port, secure, username, credential_ref_id, status, organization_id)
        VALUES (${slotLabel}, ${imapHost}, ${imapPort}, ${imapSecure}, ${email}, ${imapCredRefId}, 'configured', ${organizationId})
      `;
    }

    // ── 2) SMTP credential + smtp_account (may use separate account from IMAP) ─
    if (smtpPassword.trim()) {
      await saveCredentialSecret({
        scope: "smtp",
        ownerId: mailSlot,
        organizationId,
        label: slotSmtpPwd,
        secret: smtpPassword,
      });
    } else if (!(await hasStoredCredentialRef("smtp", mailSlot, organizationId))) {
      return { status: "error", message: "Bitte ein Passwort eingeben (noch kein SMTP-Passwort gespeichert)." };
    }

    await saveStoredSmtpAccount(
      mailSlot,
      { host: smtpHost, port: smtpPort, secure: smtpSecure, username: smtpEmail, fromAddress: smtpEmail },
    );

    revalidatePath("/");
    revalidatePath("/einstellungen");
    return { status: "success", message: "Postfach verbunden." };
  } catch (error) {
    return { status: "error", message: sanitizeCredentialError(error) };
  }
}

export async function runImapScanAction(_previousState: CredentialFormState): Promise<CredentialFormState> {
  void _previousState;

  await requireCurrentAuth();

  try {
    const result = await runPrimaryImapScan();
    revalidatePath("/");
    revalidatePath("/audit");
    revalidatePath("/audit");
    revalidatePath("/fehlt");
    revalidatePath("/");
    revalidatePath("/einstellungen");

    const mailboxLabel =
      result.accountsScanned === 1 ? "1 Postfach" : `${result.accountsScanned} Postfächer`;

    const blockedSuffix = result.blockedSenders > 0 ? `, ${result.blockedSenders} blockierte Sender übersprungen` : "";
    return {
      status: "success",
      message: `${result.messagesSeen} Mails geprüft (${mailboxLabel}), ${result.imported} PDFs importiert, ${result.duplicates} Dubletten${blockedSuffix}.`,
    };
  } catch (error) {
    return { status: "error", message: sanitizeCredentialError(error) };
  }
}

export async function testMistralConnectionAction(
  _previousState: CredentialFormState,
): Promise<CredentialFormState> {
  void _previousState;

  await requireCurrentAuth();

  try {
    const result = await verifyMistralConnection();
    revalidatePath("/");
    revalidatePath("/einstellungen");
    return {
      status: "success",
      message: `Mistral Verbindung erfolgreich. ${result.count} Modelle erreichbar, Beispiel: ${result.model}.`,
    };
  } catch (error) {
    return { status: "error", message: sanitizeCredentialError(error) };
  }
}

export async function testImapConnectionAction(
  _previousState: CredentialFormState,
  formData: FormData,
): Promise<CredentialFormState> {
  void _previousState;

  await requireCurrentAuth();

  try {
    const slotParam = String(formData.get("imapSlot") || "primary").trim();
    if (slotParam !== "primary" && slotParam !== "secondary") {
      return { status: "error", message: "Ungültiges IMAP-Konto." };
    }

    const result = await verifyImapAccountConnection(slotParam);
    revalidatePath("/");
    revalidatePath("/einstellungen");
    return {
      status: "success",
      message: `${result.label}: Verbindung erfolgreich (${result.username} @ ${result.host}).`,
    };
  } catch (error) {
    const raw = error instanceof Error ? error.message : String(error);
    const brief = raw.split("\n")[0].slice(0, 200);
    return { status: "error", message: brief };
  }
}

export async function testSmtpConnectionAction(
  _previousState: CredentialFormState,
  formData: FormData,
): Promise<CredentialFormState> {
  void _previousState;

  await requireCurrentAuth();

  try {
    const slotParam = String(formData.get("smtpSlot") || "primary").trim();
    if (slotParam !== "primary" && slotParam !== "secondary") {
      return { status: "error", message: "Ungültiges SMTP-Konto." };
    }

    const result = await verifySmtpAccountConnection(slotParam);
    revalidatePath("/einstellungen");
    return {
      status: "success",
      message: `${result.label}: Verbindung erfolgreich (${result.username} @ ${result.host}:${result.port}).`,
    };
  } catch (error) {
    const raw = error instanceof Error ? error.message : String(error);
    const brief = raw.split("\n")[0].slice(0, 200);
    return { status: "error", message: brief };
  }
}

export async function saveExportTargetAction(
  _previousState: CredentialFormState,
  formData: FormData,
): Promise<CredentialFormState> {
  void _previousState;

  const auth = await requireCurrentAuth();

  try {
    if (!auth.organization) {
      return { status: "error", message: "Keine aktive Organisation." };
    }

    const target = String(formData.get("exportTarget") || "").trim();
    if (target !== "kontist" && target !== "accountable") {
      return { status: "error", message: "Ungültiges Export-Ziel." };
    }

    const recipientEmail = String(formData.get("recipientEmail") || "").trim() || null;
    const smtpSlotRaw = String(formData.get("smtpSlot") || "primary").trim();
    const smtpSlot = SMTP_ACCOUNT_SLOTS.find((s) => s.ownerId === smtpSlotRaw);
    if (!smtpSlot) {
      return { status: "error", message: "Ungültiges SMTP-Postfach ausgewählt." };
    }
    const enabled = formData.get("enabled") === "on";

    await saveExportTarget(auth.organization.id, target, recipientEmail, smtpSlot.ownerId, enabled);

    revalidatePath("/einstellungen");
    revalidatePath("/exports");
    const label = target === "kontist" ? "Kontist" : "Accountable";
    return {
      status: "success",
      message: `${label}: Export-Ziel gespeichert${enabled ? " und aktiviert" : " (deaktiviert)"}.`,
    };
  } catch (error) {
    const msg = error instanceof Error ? error.message : "Unbekannter Fehler.";
    return { status: "error", message: msg };
  }
}

function sanitizeCredentialError(error: unknown) {
  const message = error instanceof Error ? error.message : "Credential konnte nicht gespeichert werden.";
  if (
    message.includes("Secret Store") ||
    message.includes("fehl") ||
    message.includes("nicht konfiguriert") ||
    message.includes("IMAP") ||
    message.includes("SMTP") ||
    message.includes("Mistral") ||
    message.includes("connect") ||
    message.includes("auth") ||
    message.includes("timeout") ||
    message.includes("certificate") ||
    message.includes("Invalid")
  ) {
    return message;
  }
  return "Credential konnte nicht sicher gespeichert werden.";
}

export type AutoApprovalRuleFormState = {
  status: "idle" | "success" | "error";
  message: string;
};

export async function saveAutoApprovalRuleAction(
  _previousState: AutoApprovalRuleFormState,
  formData: FormData,
): Promise<AutoApprovalRuleFormState> {
  void _previousState;
  const auth = await requireCurrentAuth();
  const orgId = auth.organization?.id ?? null;
  try {
    const idValue = String(formData.get("id") || "").trim();
    const vendorIdValue = String(formData.get("vendorId") || "").trim();
    const vendorPattern = String(formData.get("vendorPattern") || "").trim();
    const maxAmountValue = String(formData.get("maxAmount") || "").trim();
    const enabled = String(formData.get("enabled") || "true") !== "false";

    const vendorId = vendorIdValue ? Number(vendorIdValue) : null;
    if (vendorIdValue && Number.isNaN(vendorId)) {
      return { status: "error", message: "Ungültige Lieferanten-ID." };
    }
    if (vendorId === null && vendorPattern.length < 2) {
      return {
        status: "error",
        message: "Bitte entweder einen Lieferanten wählen oder ein Pattern (≥ 2 Zeichen) eingeben.",
      };
    }

    let maxAmountCents: number | null = null;
    if (maxAmountValue) {
      const normalized = maxAmountValue.replace(",", ".");
      const parsed = Number(normalized);
      if (Number.isNaN(parsed) || parsed < 0) {
        return { status: "error", message: "Betragsgrenze muss eine positive Zahl sein." };
      }
      maxAmountCents = Math.round(parsed * 100);
    }

    await upsertAutoApprovalRule({
      id: idValue ? Number(idValue) : undefined,
      organizationId: orgId,
      vendorId,
      vendorPattern: vendorPattern ? vendorPattern : null,
      maxAmountCents,
      enabled,
    });

    revalidatePath("/einstellungen");
    return { status: "success", message: idValue ? "Regel aktualisiert." : "Regel hinzugefügt." };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Konnte Regel nicht speichern.";
    return { status: "error", message };
  }
}

export async function deleteAutoApprovalRuleAction(
  _previousState: AutoApprovalRuleFormState,
  formData: FormData,
): Promise<AutoApprovalRuleFormState> {
  void _previousState;
  const auth = await requireCurrentAuth();
  const orgId = auth.organization?.id ?? null;
  try {
    const idValue = String(formData.get("id") || "").trim();
    const id = Number(idValue);
    if (!idValue || Number.isNaN(id)) {
      return { status: "error", message: "Ungültige Regel-ID." };
    }
    await deleteAutoApprovalRule(id, orgId);
    revalidatePath("/einstellungen");
    return { status: "success", message: "Regel entfernt." };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Konnte Regel nicht entfernen.";
    return { status: "error", message };
  }
}

export type IntegrationFormState = {
  status: "idle" | "success" | "error";
  message: string;
  provider?: IntegrationProvider;
};

export async function saveLexofficeApiKeyAction(
  _previousState: IntegrationFormState,
  formData: FormData,
): Promise<IntegrationFormState> {
  void _previousState;
  try {
    const auth = await getCurrentAuth();
    const exportAllowed = await canExport(auth?.organization?.id ?? null);
    if (!exportAllowed) {
      return { status: "error", message: "Integrationen sind nur im Pro-Plan verfügbar.", provider: "lexoffice" };
    }

    const apiKey = String(formData.get("apiKey") || "").trim();
    if (apiKey.length < 16) {
      return { status: "error", message: "API-Key sieht zu kurz aus (min. 16 Zeichen)." };
    }

    let profile;
    try {
      profile = await verifyLexofficeConnection(apiKey);
    } catch (error) {
      if (error instanceof LexofficeApiError) {
        return { status: "error", message: error.message, provider: "lexoffice" };
      }
      throw error;
    }

    const secretRef = await saveCredentialSecret({
      scope: "lexoffice",
      label: `lexoffice — ${profile.companyName}`,
      secret: apiKey,
    });

    await upsertIntegrationTarget({
      organizationId: auth?.organization?.id ?? null,
      provider: "lexoffice",
      label: profile.companyName,
      oauthTokenRef: secretRef,
      externalAccountId: profile.organizationId,
      enabled: true,
    });
    await markIntegrationVerified("lexoffice", auth?.organization?.id ?? null);

    revalidatePath("/einstellungen");
    return {
      status: "success",
      message: `lexoffice verbunden mit "${profile.companyName}". Auto-Push aktiviert.`,
      provider: "lexoffice",
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Konnte lexoffice-API-Key nicht speichern.";
    return { status: "error", message, provider: "lexoffice" };
  }
}

export async function saveSevdeskApiKeyAction(
  _previousState: IntegrationFormState,
  formData: FormData,
): Promise<IntegrationFormState> {
  void _previousState;
  try {
    const auth = await getCurrentAuth();
    const exportAllowed = await canExport(auth?.organization?.id ?? null);
    if (!exportAllowed) {
      return { status: "error", message: "Integrationen sind nur im Pro-Plan verfügbar.", provider: "sevdesk" };
    }

    const apiKey = String(formData.get("apiKey") || "").trim();
    if (apiKey.length < 16) {
      return { status: "error", message: "API-Key sieht zu kurz aus (min. 16 Zeichen)." };
    }

    let userInfo;
    try {
      userInfo = await verifySevdeskConnection(apiKey);
    } catch (error) {
      if (error instanceof SevdeskApiError) {
        return { status: "error", message: error.message, provider: "sevdesk" };
      }
      throw error;
    }

    const label = userInfo.sevClient?.name ?? userInfo.fullname;
    const secretRef = await saveCredentialSecret({
      scope: "sevdesk",
      label: `sevDesk — ${label}`,
      secret: apiKey,
    });

    await upsertIntegrationTarget({
      organizationId: auth?.organization?.id ?? null,
      provider: "sevdesk",
      label,
      oauthTokenRef: secretRef,
      externalAccountId: userInfo.sevClient?.id ?? userInfo.id,
      enabled: true,
    });
    await markIntegrationVerified("sevdesk", auth?.organization?.id ?? null);

    revalidatePath("/einstellungen");
    return {
      status: "success",
      message: `sevDesk verbunden mit "${label}". Auto-Push aktiviert.`,
      provider: "sevdesk",
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Konnte sevDesk-API-Key nicht speichern.";
    return { status: "error", message, provider: "sevdesk" };
  }
}

export type ConfidenceThresholdState = {
  status: "idle" | "success" | "error";
  message: string;
  value?: number;
};

export async function updateConfidenceThresholdAction(
  _previousState: ConfidenceThresholdState,
  formData: FormData,
): Promise<ConfidenceThresholdState> {
  void _previousState;
  await requireCurrentAuth();
  try {
    const raw = Number(formData.get("confidence"));
    if (isNaN(raw) || raw < 0.5 || raw > 0.99) {
      return { status: "error", message: "Ungültiger Wert (50–99%)." };
    }
    await writeJsonSetting("auto_approve_confidence", raw);
    revalidatePath("/einstellungen");
    return { status: "success", message: "Konfidenz-Schwelle gespeichert.", value: raw };
  } catch (error) {
    return {
      status: "error",
      message: error instanceof Error ? error.message : "Konnte nicht speichern.",
    };
  }
}

export type SubjectTemplateState = {
  status: "idle" | "success" | "error";
  message: string;
  value?: string;
};

export async function updateInvoiceSubjectTemplateAction(
  _previousState: SubjectTemplateState,
  formData: FormData,
): Promise<SubjectTemplateState> {
  void _previousState;
  await requireCurrentAuth();
  try {
    const raw = String(formData.get("subjectTemplate") || "").replace(/[\r\n]+/g, " ").trim();
    if (raw.length > 200) {
      return { status: "error", message: "Betreff-Schema ist zu lang (max. 200 Zeichen)." };
    }
    await writeJsonSetting("invoice_subject_template", raw);
    revalidatePath("/einstellungen");
    return { status: "success", message: "Betreff-Schema gespeichert.", value: raw };
  } catch (error) {
    return {
      status: "error",
      message: error instanceof Error ? error.message : "Konnte nicht speichern.",
    };
  }
}

export async function disconnectIntegrationAction(
  _previousState: IntegrationFormState,
  formData: FormData,
): Promise<IntegrationFormState> {
  void _previousState;
  const auth = await requireCurrentAuth();
  try {
    const provider = String(formData.get("provider") || "").trim() as IntegrationProvider;
    if (!["lexoffice", "sevdesk", "datev"].includes(provider)) {
      return { status: "error", message: "Unbekannter Provider." };
    }
    await disableIntegrationTarget(provider, auth.organization?.id ?? null);
    revalidatePath("/einstellungen");
    return { status: "success", message: `${provider} getrennt.`, provider };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Konnte Integration nicht trennen.";
    return { status: "error", message };
  }
}

// ─── Profil ──────────────────────────────────────────────────────────────────

export type ProfileState = {
  status: "idle" | "success" | "error";
  message: string;
};

export async function updateProfileAction(
  _previousState: ProfileState,
  formData: FormData,
): Promise<ProfileState> {
  void _previousState;
  try {
    const auth = await getCurrentAuth();
    if (!auth) return { status: "error", message: "Nicht angemeldet." };

    const name = String(formData.get("name") || "").trim();
    if (!name) return { status: "error", message: "Name darf nicht leer sein." };
    if (name.length > 120) return { status: "error", message: "Name ist zu lang (max. 120 Zeichen)." };

    const companyName = String(formData.get("companyName") || "").trim().slice(0, 200);
    const vatId = String(formData.get("vatId") || "").trim().slice(0, 50);

    await updateUserProfile(auth.user.id, { name, companyName, vatId });
    revalidatePath("/konto");
    return { status: "success", message: "Profil gespeichert." };
  } catch (error) {
    return {
      status: "error",
      message: error instanceof Error ? error.message : "Profil konnte nicht gespeichert werden.",
    };
  }
}

// ─── Sitzungen ───────────────────────────────────────────────────────────────

export type SessionsState = {
  status: "idle" | "success" | "error";
  message: string;
};

export async function invalidateAllOtherSessionsAction(
  _previousState: SessionsState,
  _formData: FormData,
): Promise<SessionsState> {
  void _previousState;
  try {
    const auth = await getCurrentAuth();
    if (!auth) return { status: "error", message: "Nicht angemeldet." };

    const { createSupabaseServerClient } = await import("@/lib/supabase/server");
    const supabase = await createSupabaseServerClient();
    const { data: { session } } = await supabase.auth.getSession();
    const jwt = session?.access_token;
    if (!jwt) return { status: "error", message: "Keine aktive Session gefunden." };

    await invalidateAllOtherSessions(jwt);
    revalidatePath("/einstellungen");
    return {
      status: "success",
      message: "Alle anderen Sitzungen wurden beendet.",
    };
  } catch (error) {
    return {
      status: "error",
      message: error instanceof Error ? error.message : "Fehler beim Abmelden.",
    };
  }
}

// ─── Empfänger löschen ───────────────────────────────────────────────────────

export async function clearExportTargetAction(formData: FormData): Promise<void> {
  // SECURITY (Seer #1): Auth + Org-Scope.
  // Vorher hätte jeder authentifizierte User den Export aller Tenants
  // abschalten können (globale export_targets-Rows mit IDs 1/2).
  // Mit Migration 0013 ist organization_id NOT NULL pro Konfig-Row.
  const auth = await requireCurrentAuth();
  if (!auth.organization) return;

  const id = Number(formData.get("targetId"));
  if (!Number.isInteger(id) || id <= 0) return;
  await sql`
    UPDATE export_targets
    SET recipient_email = NULL, enabled = FALSE, smtp_slot = 'primary', updated_at = CURRENT_TIMESTAMP
    WHERE id = ${id} AND organization_id = ${auth.organization.id}
  `;
  revalidatePath("/einstellungen");
}

export async function switchOrganizationAction(
  _previousState: SessionsState,
  formData: FormData,
): Promise<SessionsState> {
  void _previousState;
  try {
    const auth = await getCurrentAuth();
    if (!auth) return { status: "error", message: "Nicht angemeldet." };

    const orgId = String(formData.get("orgId") || "").trim();
    if (!orgId) return { status: "error", message: "Keine Organisation angegeben." };

    // Verify membership
    const memberRows = await sql`
      SELECT 1 FROM org_members WHERE organization_id = ${orgId} AND user_id = ${auth.user.id}
    `;
    if (!memberRows[0]) return { status: "error", message: "Kein Zugriff auf diese Organisation." };

    await sql`
      UPDATE sessions SET active_organization_id = ${orgId} WHERE id = ${auth.session.id}
    `;
  } catch (error) {
    return {
      status: "error",
      message: error instanceof Error ? error.message : "Wechsel fehlgeschlagen.",
    };
  }
  redirect("/");
}

// ── Konto löschen (Self-Service, unwiderruflich) ───────────────────────────────

export type AccountDeletionState = {
  status: "idle" | "error";
  message: string;
};

type OrgConnectionRow = {
  orgId: string;
  orgName: string;
  ownerUserId: string;
  stripeSubscriptionId: string | null;
  memberCount: number;
  isMember: boolean;
};

/**
 * Löscht das eigene Konto sofort und unwiderruflich.
 *
 * Bestätigung: Der Nutzer muss seine eigene E-Mail-Adresse eintippen.
 *
 * Inhaber-Quelle ist organizations.owner_user_id (maßgeblich, von Billing/
 * Automation genutzt) — NICHT org_members.role, das (Prod-Drift) abweichen kann.
 *
 * Vorgehen (bewusst KEIN harter Cascade-Delete — Prod-Schema-Drift):
 *  1. Validierung + Eigentümer-Guard: Ist der Nutzer maßgeblicher Inhaber
 *     einer Organisation mit weiteren Mitgliedern → Abbruch mit Hinweis.
 *  2. Stripe-Abo der allein-besessenen Orgs sofort kündigen (extern, zuerst —
 *     schlägt das fehl, wird NICHTS gelöscht).
 *  3. DB-Transaktion: allein-besessene Orgs + Nutzer soft-deleten
 *     (deleted_at), org_members des Nutzers entfernen.
 *  4. Storage hart löschen (nach DB-Commit): Rechnungs-PDFs, Rohtext, Avatar.
 *  5. Supabase-Auth-User hart löschen → Login dauerhaft unmöglich.
 *  6. Lokale Session beenden und zur Login-Seite leiten.
 *
 * Relationale Metadaten-Zeilen bleiben soft-deleted und werden später per
 * Purge-Job endgültig entfernt.
 */
export async function deleteAccountAction(
  _prev: AccountDeletionState,
  formData: FormData,
): Promise<AccountDeletionState> {
  const auth = await requireCurrentAuth();
  const userId = auth.user.id;
  const authUserId = auth.session.id; // Supabase auth.users id
  const email = auth.user.email.trim().toLowerCase();

  const confirm = String(formData.get("confirm") ?? "")
    .trim()
    .toLowerCase();
  if (confirm !== email) {
    return {
      status: "error",
      message:
        "Bitte gib zur Bestätigung deine E-Mail-Adresse exakt ein.",
    };
  }

  // 1. Alle Orgs ermitteln, mit denen der Nutzer verbunden ist — entweder als
  //    autoritativer Inhaber (organizations.owner_user_id, NOT NULL, von
  //    Billing/Automation genutzt) ODER als org_members-Mitglied. owner_user_id
  //    ist die maßgebliche Inhaber-Quelle; org_members.role kann (Prod-Drift)
  //    davon abweichen und darf NICHT über Org-Abbau entscheiden.
  let connections: OrgConnectionRow[];
  try {
    connections = await sql<OrgConnectionRow[]>`
      SELECT
        o.id                     AS "orgId",
        o.name                   AS "orgName",
        o.owner_user_id          AS "ownerUserId",
        o.stripe_subscription_id AS "stripeSubscriptionId",
        (SELECT COUNT(*) FROM org_members om
           WHERE om.organization_id = o.id) AS "memberCount",
        EXISTS (SELECT 1 FROM org_members om
           WHERE om.organization_id = o.id
             AND om.user_id = ${userId}) AS "isMember"
      FROM organizations o
      WHERE o.deleted_at IS NULL
        AND (
          o.owner_user_id = ${userId}
          OR EXISTS (SELECT 1 FROM org_members om
               WHERE om.organization_id = o.id AND om.user_id = ${userId})
        )
    `;
  } catch (error) {
    console.error("[deleteAccountAction] org lookup failed:", error);
    return {
      status: "error",
      message: "Konto konnte nicht gelöscht werden. Bitte später erneut versuchen.",
    };
  }

  // Für jede Org: Bin ich der maßgebliche Inhaber? Gibt es ANDERE Mitglieder?
  const owned = connections.filter((c) => c.ownerUserId === userId);
  const otherMembers = (c: OrgConnectionRow) =>
    c.memberCount - (c.isMember ? 1 : 0);

  // Guard: maßgeblicher Inhaber, aber weitere Mitglieder → blockieren
  // (keine Inhaberschafts-Übertragung implementiert).
  const blocking = owned.find((c) => otherMembers(c) >= 1);
  if (blocking) {
    return {
      status: "error",
      message:
        `In „${blocking.orgName}“ bist du einziger Inhaber, aber es gibt ` +
        `weitere Mitglieder. Übertrage zuerst die Inhaberschaft oder ` +
        `entferne die anderen Mitglieder, dann kannst du dein Konto löschen.`,
    };
  }

  // Allein-besessene Orgs: maßgeblicher Inhaber, keine anderen Mitglieder
  // → komplett abbauen. Orgs, in denen der Nutzer nur (Nicht-Inhaber-)
  // Mitglied ist, bleiben unangetastet (nur die Mitgliedschaft wird entfernt).
  const soloOrgs = owned.filter((c) => otherMembers(c) === 0);

  // 2. Stripe zuerst — bei Fehler abbrechen, bevor etwas zerstört wird.
  try {
    for (const org of soloOrgs) {
      await cancelSubscriptionImmediately(org.stripeSubscriptionId);
    }
  } catch (error) {
    console.error("[deleteAccountAction] stripe cancel failed:", error);
    return {
      status: "error",
      message:
        "Das Abo konnte nicht gekündigt werden. Konto wurde NICHT gelöscht. " +
        "Bitte Support kontaktieren.",
    };
  }

  // 3. DB-Transaktion zuerst: Orgs + Nutzer soft-deleten, Mitgliedschaften
  //    entfernen. Schlägt das fehl, ist NICHTS in Storage gelöscht und der
  //    Nutzer kann sich noch einloggen → sauberer Fehler-Rückgabe.
  try {
    await sql.begin(async (tx) => {
      for (const org of soloOrgs) {
        await tx`
          UPDATE organizations
          SET deleted_at = NOW()::TEXT, updated_at = NOW()::TEXT
          WHERE id = ${org.orgId}
        `;
      }
      await tx`DELETE FROM org_members WHERE user_id = ${userId}`;
      await tx`
        UPDATE users
        SET deleted_at = NOW()::TEXT, updated_at = NOW()::TEXT
        WHERE id = ${userId}
      `;
    });
  } catch (error) {
    console.error("[deleteAccountAction] DB teardown failed:", error);
    return {
      status: "error",
      message:
        "Konto konnte nicht vollständig gelöscht werden. Bitte Support kontaktieren.",
    };
  }

  // 4. Storage hart löschen — NACH dem DB-Commit (der Nutzer ist jetzt bereits
  //    ausgesperrt). Best-effort: Fehler dürfen das Löschen nicht blockieren,
  //    der unwiderrufliche Kern ist bereits erfolgt.
  for (const org of soloOrgs) {
    try {
      const pdfRows = await sql<{ storedPath: string }[]>`
        SELECT f.stored_path AS "storedPath"
        FROM invoice_files f
        INNER JOIN invoices i ON i.id = f.invoice_id
        WHERE i.organization_id = ${org.orgId}
      `;
      const rawRows = await sql<{ rawTextPath: string | null }[]>`
        SELECT raw_text_path AS "rawTextPath"
        FROM invoices
        WHERE organization_id = ${org.orgId} AND raw_text_path IS NOT NULL
      `;
      for (const r of pdfRows) {
        await deleteFromStorage(BUCKETS.INVOICES, r.storedPath);
      }
      for (const r of rawRows) {
        if (r.rawTextPath) {
          await deleteFromStorage(BUCKETS.RAW_TEXT, r.rawTextPath);
        }
      }
    } catch (error) {
      console.error(
        `[deleteAccountAction] storage purge failed for org ${org.orgId}:`,
        error,
      );
    }
  }

  // Avatar (Bucket "avatars", Schlüssel "{userId}/avatar.{ext}").
  try {
    const admin = createSupabaseAdminClient();
    const { data: avatarFiles } = await admin.storage
      .from("avatars")
      .list(userId);
    if (avatarFiles && avatarFiles.length > 0) {
      await admin.storage
        .from("avatars")
        .remove(avatarFiles.map((f) => `${userId}/${f.name}`));
    }
  } catch (error) {
    console.error("[deleteAccountAction] avatar purge failed:", error);
  }

  // 5. Supabase-Auth-User hart löschen. Schlägt das fehl, ist der Nutzer
  //    durch users.deleted_at bereits dauerhaft ausgesperrt (findUserByEmail
  //    filtert deleted_at) — nur protokollieren, nicht abbrechen.
  try {
    const admin = createSupabaseAdminClient();
    const { error } = await admin.auth.admin.deleteUser(authUserId);
    if (error) {
      console.error(
        "[deleteAccountAction] supabase deleteUser failed (user is locked out via soft-delete; auth row needs manual cleanup):",
        error,
      );
    }
  } catch (error) {
    console.error("[deleteAccountAction] supabase deleteUser threw:", error);
  }

  // 6. Lokale Session beenden, dann zur Login-Seite.
  try {
    const supabase = await createSupabaseServerClient();
    await supabase.auth.signOut();
  } catch (error) {
    console.error("[deleteAccountAction] signOut failed:", error);
  }

  redirect("/login?deleted=1");
}
