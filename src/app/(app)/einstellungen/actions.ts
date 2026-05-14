"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { appConfig } from "@/lib/config/env";
import { getDb } from "@/lib/db/client";
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
import { getCurrentAuth } from "@/lib/auth/current";
import { updateUserName, updateUserProfile, invalidateAllOtherSessions } from "@/lib/auth/session";

export type CredentialFormState = {
  status: "idle" | "success" | "error";
  message: string;
};

export async function saveMistralCredentialAction(
  _previousState: CredentialFormState,
  formData: FormData,
): Promise<CredentialFormState> {
  void _previousState;

  try {
    assertLocalSecretActionsAllowed();
    const apiKey = String(formData.get("mistralApiKey") || "").trim();
    if (apiKey.length < 16) {
      return { status: "error", message: "Bitte einen gültigen Mistral API Key eingeben." };
    }

    await saveCredentialSecret({
      scope: "mistral",
      ownerId: "default",
      label: "Mistral API Key",
      secret: apiKey,
    });

    revalidatePath("/");
    revalidatePath("/einstellungen");
    return { status: "success", message: "Mistral API Key wurde im OS Secret Store gespeichert." };
  } catch (error) {
    return { status: "error", message: sanitizeCredentialError(error) };
  }
}

export async function saveImapCredentialAction(
  _previousState: CredentialFormState,
  formData: FormData,
): Promise<CredentialFormState> {
  void _previousState;

  try {
    assertLocalSecretActionsAllowed();
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

    const db = getDb();
    const credentialLabel = slot.label === "Primary IMAP" ? "Primary IMAP Password" : "Secondary IMAP Password";

    let credentialRefId: number | null = null;

    if (password.trim()) {
      const secretRef = await saveCredentialSecret({
        db,
        scope: "imap",
        ownerId: slot.ownerId,
        label: credentialLabel,
        secret: password,
      });
      const credential = db
        .prepare(`SELECT id FROM credential_refs WHERE secret_ref = ?`)
        .get(secretRef) as { id: number } | undefined;
      credentialRefId = credential?.id ?? null;
    } else if (!hasStoredCredentialRef(db, "imap", slot.ownerId)) {
      return { status: "error", message: "Bitte ein Passwort eingeben (noch kein Passwort gespeichert)." };
    } else {
      const existing = db.prepare(`SELECT credential_ref_id FROM mail_accounts WHERE label = ? LIMIT 1`).get(slot.label) as
        | { credential_ref_id: number | null }
        | undefined;
      credentialRefId = existing?.credential_ref_id ?? null;
    }

    const existingAccount = db.prepare(`SELECT id FROM mail_accounts WHERE label = ? LIMIT 1`).get(slot.label) as
      | { id: number }
      | undefined;

    if (existingAccount) {
      db.prepare(
        `UPDATE mail_accounts
         SET host = ?, port = ?, secure = ?, username = ?, credential_ref_id = ?,
           status = 'configured', updated_at = CURRENT_TIMESTAMP
         WHERE id = ?`,
      ).run(host, port, secure ? 1 : 0, username, credentialRefId, existingAccount.id);
    } else {
      db.prepare(
        `INSERT INTO mail_accounts (label, host, port, secure, username, credential_ref_id, status)
         VALUES (?, ?, ?, ?, ?, ?, 'configured')`,
      ).run(slot.label, host, port, secure ? 1 : 0, username, credentialRefId);
    }

    revalidatePath("/");
    revalidatePath("/einstellungen");
    return {
      status: "success",
      message: `${slot.label}: Zugang wurde gespeichert. Das Passwort liegt im OS Secret Store.`,
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

  try {
    assertLocalSecretActionsAllowed();
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

    const db = getDb();

    if (password.trim()) {
      await saveCredentialSecret({
        db,
        scope: "smtp",
        ownerId: slot.ownerId,
        label: `${slot.label} Password`,
        secret: password,
      });
    } else if (!hasStoredCredentialRef(db, "smtp", slot.ownerId)) {
      return { status: "error", message: "Bitte ein Passwort eingeben (noch kein Passwort gespeichert)." };
    }

    saveStoredSmtpAccount(slot.ownerId, { host, port, secure, username, fromAddress }, db);

    revalidatePath("/");
    revalidatePath("/einstellungen");
    return {
      status: "success",
      message: `${slot.label}: Zugang gespeichert. Das Passwort liegt im OS Secret Store.`,
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
  try {
    assertLocalSecretActionsAllowed();

    const mailSlot   = (String(formData.get("mailSlot") || "primary") === "secondary" ? "secondary" : "primary") as "primary" | "secondary";
    const slotLabel  = mailSlot === "secondary" ? "Secondary IMAP" : "Primary IMAP";
    const slotPwd    = mailSlot === "secondary" ? "Secondary IMAP Password" : "Primary IMAP Password";
    const slotSmtpPwd = mailSlot === "secondary" ? "Secondary SMTP Password" : "Primary SMTP Password";

    const email    = String(formData.get("mailEmail")    || "").trim();
    const password = String(formData.get("mailPassword") || "");
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

    const db = getDb();

    // ── 1) IMAP credential + mail_account ─────────────────────────────────────
    let imapCredRefId: number | null = null;
    if (password.trim()) {
      const secretRef = await saveCredentialSecret({
        db,
        scope: "imap",
        ownerId: mailSlot,
        label: slotPwd,
        secret: password,
      });
      const cred = db
        .prepare(`SELECT id FROM credential_refs WHERE secret_ref = ?`)
        .get(secretRef) as { id: number } | undefined;
      imapCredRefId = cred?.id ?? null;
    } else if (!hasStoredCredentialRef(db, "imap", mailSlot)) {
      return { status: "error", message: "Bitte ein Passwort eingeben (noch kein Passwort gespeichert)." };
    } else {
      const existing = db
        .prepare(`SELECT credential_ref_id FROM mail_accounts WHERE label = ? LIMIT 1`)
        .get(slotLabel) as { credential_ref_id: number | null } | undefined;
      imapCredRefId = existing?.credential_ref_id ?? null;
    }

    const existingImap = db
      .prepare(`SELECT id FROM mail_accounts WHERE label = ? LIMIT 1`)
      .get(slotLabel) as { id: number } | undefined;

    if (existingImap) {
      db.prepare(
        `UPDATE mail_accounts
           SET host = ?, port = ?, secure = ?, username = ?, credential_ref_id = ?,
               status = 'configured', updated_at = CURRENT_TIMESTAMP
         WHERE id = ?`,
      ).run(imapHost, imapPort, imapSecure ? 1 : 0, email, imapCredRefId, existingImap.id);
    } else {
      db.prepare(
        `INSERT INTO mail_accounts (label, host, port, secure, username, credential_ref_id, status)
         VALUES (?, ?, ?, ?, ?, ?, 'configured')`,
      ).run(slotLabel, imapHost, imapPort, imapSecure ? 1 : 0, email, imapCredRefId);
    }

    // ── 2) SMTP credential + smtp_account ─────────────────────────────────────
    if (password.trim()) {
      await saveCredentialSecret({
        db,
        scope: "smtp",
        ownerId: mailSlot,
        label: slotSmtpPwd,
        secret: password,
      });
    } else if (!hasStoredCredentialRef(db, "smtp", mailSlot)) {
      return { status: "error", message: "Bitte ein Passwort eingeben (noch kein SMTP-Passwort gespeichert)." };
    }

    saveStoredSmtpAccount(
      mailSlot,
      { host: smtpHost, port: smtpPort, secure: smtpSecure, username: email, fromAddress: email },
      db,
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

  try {
    const db = getDb();
    const result = await verifyMistralConnection(db);
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

  try {
    const slotParam = String(formData.get("imapSlot") || "primary").trim();
    if (slotParam !== "primary" && slotParam !== "secondary") {
      return { status: "error", message: "Ungültiges IMAP-Konto." };
    }

    const db = getDb();
    const result = await verifyImapAccountConnection(slotParam, db);
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

  try {
    const slotParam = String(formData.get("smtpSlot") || "primary").trim();
    if (slotParam !== "primary" && slotParam !== "secondary") {
      return { status: "error", message: "Ungültiges SMTP-Konto." };
    }

    const db = getDb();
    const result = await verifySmtpAccountConnection(slotParam, db);
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

  try {
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

    const db = getDb();
    saveExportTarget(target, recipientEmail, smtpSlot.ownerId, enabled, db);

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

function assertLocalSecretActionsAllowed() {
  const host = appConfig.host;
  if (host !== "127.0.0.1" && host !== "localhost" && host !== "::1") {
    throw new Error("Secret-Aktionen sind nur bei lokaler Serverbindung erlaubt.");
  }
}

function sanitizeCredentialError(error: unknown) {
  const message = error instanceof Error ? error.message : "Credential konnte nicht gespeichert werden.";
  if (
    message.includes("OS Secret Store") ||
    message.includes("lokaler Serverbindung") ||
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

    upsertAutoApprovalRule({
      id: idValue ? Number(idValue) : undefined,
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
  try {
    const idValue = String(formData.get("id") || "").trim();
    const id = Number(idValue);
    if (!idValue || Number.isNaN(id)) {
      return { status: "error", message: "Ungültige Regel-ID." };
    }
    deleteAutoApprovalRule(id);
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
    assertLocalSecretActionsAllowed();
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

    upsertIntegrationTarget({
      provider: "lexoffice",
      label: profile.companyName,
      oauthTokenRef: secretRef,
      externalAccountId: profile.organizationId,
      enabled: true,
    });
    markIntegrationVerified("lexoffice");

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
    assertLocalSecretActionsAllowed();
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

    upsertIntegrationTarget({
      provider: "sevdesk",
      label,
      oauthTokenRef: secretRef,
      externalAccountId: userInfo.sevClient?.id ?? userInfo.id,
      enabled: true,
    });
    markIntegrationVerified("sevdesk");

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
  try {
    const raw = Number(formData.get("confidence"));
    if (isNaN(raw) || raw < 0.5 || raw > 0.99) {
      return { status: "error", message: "Ungültiger Wert (50–99%)." };
    }
    const db = getDb();
    writeJsonSetting("auto_approve_confidence", raw, db);
    revalidatePath("/einstellungen");
    return { status: "success", message: "Konfidenz-Schwelle gespeichert.", value: raw };
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
  try {
    const provider = String(formData.get("provider") || "").trim() as IntegrationProvider;
    if (!["lexoffice", "sevdesk", "datev"].includes(provider)) {
      return { status: "error", message: "Unbekannter Provider." };
    }
    disableIntegrationTarget(provider);
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

    updateUserProfile(auth.user.id, { name, companyName, vatId });
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

    const count = invalidateAllOtherSessions(auth.user.id, auth.session.id);
    revalidatePath("/einstellungen");
    return {
      status: "success",
      message: count > 0 ? `${count} Sitzung${count === 1 ? "" : "en"} beendet.` : "Keine anderen aktiven Sitzungen.",
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
  const id = Number(formData.get("targetId"));
  if (!id) return;
  const db = getDb();
  db.prepare(
    `UPDATE export_targets
     SET recipient_email = NULL, enabled = 0, smtp_slot = 'primary', updated_at = CURRENT_TIMESTAMP
     WHERE id = ?`,
  ).run(id);
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

    const db = getDb();
    // Verify membership
    const member = db
      .prepare(`SELECT 1 FROM org_members WHERE organization_id = ? AND user_id = ?`)
      .get(orgId, auth.user.id);
    if (!member) return { status: "error", message: "Kein Zugriff auf diese Organisation." };

    db.prepare(`UPDATE sessions SET active_organization_id = ? WHERE id = ?`)
      .run(orgId, auth.session.id);
  } catch (error) {
    return {
      status: "error",
      message: error instanceof Error ? error.message : "Wechsel fehlgeschlagen.",
    };
  }
  redirect("/");
}
