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
