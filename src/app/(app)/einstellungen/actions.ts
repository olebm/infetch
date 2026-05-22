"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { IMAP_MAIL_ACCOUNT_SLOTS } from "@/mail/imap-account-slots";
import { SMTP_ACCOUNT_SLOTS } from "@/mail/smtp-account-slots";
import { saveStoredSmtpAccount } from "@/mail/smtp-settings";
import { saveCredentialSecret, hasStoredCredentialRef } from "@/lib/secrets/credential-store";
import { verifyMistralConnection } from "@/ai/mistral-client";
import { verifyImapAccountConnection } from "@/mail/imap-client";
import { runPrimaryImapScan } from "@/mail/mail-scanner";
import { saveExportTarget } from "@/exports/export-pipeline";
import { isValidEmail } from "@/lib/validation/email";
import {
  deleteAutoApprovalRule,
  upsertAutoApprovalRule,
  upsertIntegrationTarget,
  disableIntegrationTarget,
  markIntegrationVerified,
  type IntegrationProvider,
} from "@/lib/db/queries";
import { writeOrgJsonSetting } from "@/lib/db/settings-store";
import { verifyLexofficeConnection, LexofficeApiError } from "@/lib/integrations/lexoffice-client";
import { verifySevdeskConnection, SevdeskApiError } from "@/lib/integrations/sevdesk-client";
import { getCurrentAuth, requireCurrentAuth } from "@/lib/auth/current";
import { getOptionalOrgColumns, hardDeleteOrgData } from "@/lib/auth/account-teardown";
import { updateUserProfile, invalidateAllOtherSessions } from "@/lib/auth/session";
import { canExport, getOrgTier, getLimits } from "@/lib/tier";
import {
  createSupabaseAdminClient,
  createSupabaseServerClient,
} from "@/lib/supabase/server";
import { cancelSubscriptionImmediately } from "@/lib/stripe";
import { BUCKETS, deleteFromStorage } from "@/lib/supabase/storage";
import { unsafeGlobalSql } from "@/lib/db/unsafe-global";
import type { ScopedSql } from "@/lib/db/scoped-query";

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
  const scopedSql = auth.scopedSql!;

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
      const credRows = await scopedSql<{ id: number }[]>`
        SELECT id FROM credential_refs WHERE secret_ref = ${secretRef}
      `;
      credentialRefId = credRows[0]?.id ?? null;
    } else if (!(await hasStoredCredentialRef("imap", slot.ownerId, organizationId))) {
      return { status: "error", message: "Bitte ein Passwort eingeben (noch kein Passwort gespeichert)." };
    } else {
      // SECURITY: Lookup scoped auf Organisation — verhindert Cross-Tenant-Match
      const existingRows = await scopedSql<{ credential_ref_id: number | null }[]>`
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
    const existingAccountRows = await scopedSql<{ id: number }[]>`
      SELECT id FROM mail_accounts
      WHERE label = ${slot.label}
        AND (organization_id = ${organizationId}
             OR (${organizationId}::text IS NULL AND organization_id IS NULL))
      LIMIT 1
    `;
    const existingAccount = existingAccountRows[0];

    if (existingAccount) {
      await scopedSql`
        UPDATE mail_accounts
        SET host = ${host}, port = ${port}, secure = ${secure}, username = ${username},
            credential_ref_id = ${credentialRefId},
            status = 'configured', organization_id = ${organizationId},
            updated_at = CURRENT_TIMESTAMP
        WHERE id = ${existingAccount.id}
      `;
    } else {
      await scopedSql`
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


type PersistOutcome = { ok: true } | { ok: false; message: string };

/**
 * Persistiert ein IMAP-Konto (credential_refs + mail_accounts) für einen Slot.
 * Tier-Gate (INFETCH-156) greift nur beim NEUEN Postfach-INSERT.
 */
async function persistImapAccount(
  scopedSql: ScopedSql,
  organizationId: string | null,
  mailSlot: "primary" | "secondary",
  args: { email: string; password: string; imapHost: string; imapPort: number; imapSecure: boolean },
): Promise<PersistOutcome> {
  const slotLabel = mailSlot === "secondary" ? "Secondary IMAP" : "Primary IMAP";
  const slotPwd   = mailSlot === "secondary" ? "Secondary IMAP Password" : "Primary IMAP Password";
  const { email, password, imapHost, imapPort, imapSecure } = args;

  let imapCredRefId: number | null = null;
  if (password.trim()) {
    const secretRef = await saveCredentialSecret({
      scope: "imap",
      ownerId: mailSlot,
      organizationId,
      label: slotPwd,
      secret: password,
    });
    const credRows = await scopedSql<{ id: number }[]>`
      SELECT id FROM credential_refs WHERE secret_ref = ${secretRef}
    `;
    imapCredRefId = credRows[0]?.id ?? null;
  } else if (!(await hasStoredCredentialRef("imap", mailSlot, organizationId))) {
    return { ok: false, message: "Bitte ein Passwort eingeben (noch kein Passwort gespeichert)." };
  } else {
    // SECURITY: Lookup scoped auf Organisation
    const existingRows = await scopedSql<{ credential_ref_id: number | null }[]>`
      SELECT credential_ref_id FROM mail_accounts
      WHERE label = ${slotLabel}
        AND (organization_id = ${organizationId}
             OR (${organizationId}::text IS NULL AND organization_id IS NULL))
      LIMIT 1
    `;
    imapCredRefId = existingRows[0]?.credential_ref_id ?? null;
  }

  // SECURITY: Lookup scoped auf Organisation
  const existingImapRows = await scopedSql<{ id: number }[]>`
    SELECT id FROM mail_accounts
    WHERE label = ${slotLabel}
      AND (organization_id = ${organizationId}
           OR (${organizationId}::text IS NULL AND organization_id IS NULL))
    LIMIT 1
  `;
  const existingImap = existingImapRows[0];

  if (existingImap) {
    await scopedSql`
      UPDATE mail_accounts
      SET host = ${imapHost}, port = ${imapPort}, secure = ${imapSecure}, username = ${email},
          credential_ref_id = ${imapCredRefId},
          status = 'configured', organization_id = ${organizationId},
          updated_at = CURRENT_TIMESTAMP
      WHERE id = ${existingImap.id}
    `;
  } else {
    // Tier-Gate (INFETCH-156): maxMailAccounts vor neuem INSERT prüfen.
    // Updates bestehender Slots sind unbegrenzt erlaubt — nur neue Einträge
    // zählen gegen das Kontingent.
    const tier = await getOrgTier(organizationId);
    const { maxMailAccounts } = getLimits(tier);
    if (Number.isFinite(maxMailAccounts)) {
      const countRows = await scopedSql<{ count: string }[]>`
        SELECT COUNT(*) AS count FROM mail_accounts WHERE organization_id = ${organizationId}
      `;
      const currentCount = Number(countRows[0]?.count ?? 0);
      if (currentCount >= maxMailAccounts) {
        return {
          ok: false,
          message: `Dein Plan erlaubt maximal ${maxMailAccounts} Postfach${maxMailAccounts !== 1 ? "fächer" : ""}. Bitte auf Pro upgraden für mehr Postfächer.`,
        };
      }
    }
    await scopedSql`
      INSERT INTO mail_accounts (label, host, port, secure, username, credential_ref_id, status, organization_id)
      VALUES (${slotLabel}, ${imapHost}, ${imapPort}, ${imapSecure}, ${email}, ${imapCredRefId}, 'configured', ${organizationId})
    `;
  }
  return { ok: true };
}

/**
 * Persistiert ein SMTP-Absende-Konto (credential + smtp_accounts-Setting) für
 * einen Slot. KEIN Tier-Gate — Senden ist Kern-Feature für alle Tarife.
 */
async function persistSmtpAccount(
  organizationId: string | null,
  mailSlot: "primary" | "secondary",
  args: { smtpEmail: string; smtpPassword: string; smtpHost: string; smtpPort: number; smtpSecure: boolean },
): Promise<PersistOutcome> {
  const slotSmtpPwd = mailSlot === "secondary" ? "Secondary SMTP Password" : "Primary SMTP Password";
  const { smtpEmail, smtpPassword, smtpHost, smtpPort, smtpSecure } = args;

  if (smtpPassword.trim()) {
    await saveCredentialSecret({
      scope: "smtp",
      ownerId: mailSlot,
      organizationId,
      label: slotSmtpPwd,
      secret: smtpPassword,
    });
  } else if (!(await hasStoredCredentialRef("smtp", mailSlot, organizationId))) {
    return { ok: false, message: "Bitte ein Passwort eingeben (noch kein SMTP-Passwort gespeichert)." };
  }

  await saveStoredSmtpAccount(
    mailSlot,
    { host: smtpHost, port: smtpPort, secure: smtpSecure, username: smtpEmail, fromAddress: smtpEmail },
  );
  return { ok: true };
}

function parseMailSlot(formData: FormData): "primary" | "secondary" {
  return String(formData.get("mailSlot") || "primary") === "secondary" ? "secondary" : "primary";
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
  const scopedSql = auth.scopedSql!;

  try {
    const mailSlot = parseMailSlot(formData);
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

    const imapResult = await persistImapAccount(scopedSql, organizationId, mailSlot, { email, password, imapHost, imapPort, imapSecure });
    if (!imapResult.ok) return { status: "error", message: imapResult.message };

    const smtpResult = await persistSmtpAccount(organizationId, mailSlot, { smtpEmail, smtpPassword, smtpHost, smtpPort, smtpSecure });
    if (!smtpResult.ok) return { status: "error", message: smtpResult.message };

    revalidatePath("/");
    revalidatePath("/einstellungen");
    return { status: "success", message: "Postfach verbunden." };
  } catch (error) {
    return { status: "error", message: sanitizeCredentialError(error) };
  }
}

/**
 * IMAP-only: speichert nur das Empfangs-Postfach (Postfächer-Tab).
 */
export async function saveImapMailboxAction(
  _previousState: CredentialFormState,
  formData: FormData,
): Promise<CredentialFormState> {
  void _previousState;

  const auth = await requireCurrentAuth();
  const scopedSql = auth.scopedSql!;

  try {
    const mailSlot   = parseMailSlot(formData);
    const email      = String(formData.get("mailEmail")    || "").trim();
    const password   = String(formData.get("mailPassword") || "");
    const imapHost   = String(formData.get("imapHost")  || "").trim();
    const imapPort   = Number(formData.get("imapPort")  || 993);
    const imapSecure = String(formData.get("imapSecure") || "true") !== "false";

    if (!email) return { status: "error", message: "Bitte eine E-Mail-Adresse eingeben." };
    if (!imapHost) return { status: "error", message: "Server-Daten fehlen — bitte einen Anbieter wählen." };
    if (!Number.isInteger(imapPort) || imapPort <= 0) return { status: "error", message: "Ungültiger IMAP-Port." };

    const organizationId = auth.organization?.id ?? null;
    const result = await persistImapAccount(scopedSql, organizationId, mailSlot, { email, password, imapHost, imapPort, imapSecure });
    if (!result.ok) return { status: "error", message: result.message };

    revalidatePath("/");
    revalidatePath("/einstellungen");
    return { status: "success", message: "Postfach verbunden." };
  } catch (error) {
    return { status: "error", message: sanitizeCredentialError(error) };
  }
}

/**
 * SMTP-only: speichert nur ein Absende-Konto (Buchhaltung-Tab). KEIN Tier-Gate.
 */
export async function saveSmtpMailboxAction(
  _previousState: CredentialFormState,
  formData: FormData,
): Promise<CredentialFormState> {
  void _previousState;

  const auth = await requireCurrentAuth();

  try {
    const mailSlot     = parseMailSlot(formData);
    const smtpEmail    = String(formData.get("smtpEmail") || formData.get("mailEmail") || "").trim();
    const smtpPassword = String(formData.get("smtpPassword") || formData.get("mailPassword") || "");
    const smtpHost     = String(formData.get("smtpHost")  || "").trim();
    const smtpPort     = Number(formData.get("smtpPort")  || 587);
    const smtpSecure   = String(formData.get("smtpSecure") || "false") !== "false";

    if (!smtpEmail) return { status: "error", message: "Bitte eine E-Mail-Adresse eingeben." };
    if (!smtpHost) return { status: "error", message: "Server-Daten fehlen — bitte einen Anbieter wählen." };
    if (!Number.isInteger(smtpPort) || smtpPort <= 0) return { status: "error", message: "Ungültiger SMTP-Port." };

    const organizationId = auth.organization?.id ?? null;
    const result = await persistSmtpAccount(organizationId, mailSlot, { smtpEmail, smtpPassword, smtpHost, smtpPort, smtpSecure });
    if (!result.ok) return { status: "error", message: result.message };

    revalidatePath("/");
    revalidatePath("/einstellungen");
    return { status: "success", message: "Absende-Konto gespeichert." };
  } catch (error) {
    return { status: "error", message: sanitizeCredentialError(error) };
  }
}

export async function runImapScanAction(_previousState: CredentialFormState): Promise<CredentialFormState> {
  void _previousState;

  const auth = await requireCurrentAuth();

  try {
    const result = await runPrimaryImapScan({ limitToOrgId: auth.organization?.id ?? null });
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

    // Format pruefen wenn eine Adresse angegeben ist (null = Empfaenger leeren,
    // bleibt erlaubt). Faengt Tippfehler ab bevor Rechnungen ins Leere gehen.
    if (recipientEmail && !isValidEmail(recipientEmail)) {
      return { status: "error", message: "Die Empfänger-E-Mail-Adresse ist unvollständig oder ungültig." };
    }

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
      organizationId: auth?.organization?.id ?? null,
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
      organizationId: auth?.organization?.id ?? null,
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
  const auth = await requireCurrentAuth();
  try {
    const raw = Number(formData.get("confidence"));
    if (isNaN(raw) || raw < 0.5 || raw > 0.99) {
      return { status: "error", message: "Ungültiger Wert (50–99%)." };
    }
    await writeOrgJsonSetting("auto_approve_confidence", auth.organization?.id ?? null, raw);
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
  const auth = await requireCurrentAuth();
  try {
    const raw = String(formData.get("subjectTemplate") || "").replace(/[\r\n]+/g, " ").trim();
    if (raw.length > 200) {
      return { status: "error", message: "Betreff-Schema ist zu lang (max. 200 Zeichen)." };
    }
    await writeOrgJsonSetting("invoice_subject_template", auth.organization?.id ?? null, raw);
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
  const scopedSql = auth.scopedSql!;

  const id = Number(formData.get("targetId"));
  if (!Number.isInteger(id) || id <= 0) return;
  await scopedSql`
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
    const scopedSql = auth.scopedSql!;

    const orgId = String(formData.get("orgId") || "").trim();
    if (!orgId) return { status: "error", message: "Keine Organisation angegeben." };

    // Verify membership
    const memberRows = await scopedSql`
      SELECT 1 FROM org_members WHERE organization_id = ${orgId} AND user_id = ${auth.user.id}
    `;
    if (!memberRows[0]) return { status: "error", message: "Kein Zugriff auf diese Organisation." };

    await scopedSql`
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
 * Vorgehen (echter Hard-Delete — Konto = unwiderruflich weg, danach kann
 * sich der Nutzer frisch neu registrieren):
 *  1. Validierung + Eigentümer-Guard: Ist der Nutzer maßgeblicher Inhaber
 *     einer Organisation mit weiteren Mitgliedern → Abbruch mit Hinweis.
 *  2. Stripe-Abo der allein-besessenen Orgs sofort kündigen (extern, zuerst —
 *     schlägt das fehl, wird NICHTS gelöscht).
 *  2b. Storage-Pfade einsammeln, BEVOR die Zeilen gelöscht werden.
 *  3. DB-Transaktion: geordneter Child→Parent-Hard-Delete aller Tenant-Daten
 *     der allein-besessenen Orgs, dann org_members + users-Zeile hart löschen.
 *     Drift-robust: verlässt sich NICHT auf ON DELETE CASCADE und referenziert
 *     migrations-spätere organization_id-Spalten nur, wenn sie real existieren
 *     (auf dem gedrifteten Prod-Schema können sie fehlen). Geteilte/globale
 *     Daten (Vendors mit organization_id IS NULL, Portal-Recipes) bleiben
 *     unangetastet — nur org-eigene Custom-Vendors werden mitgelöscht.
 *  4. Storage hart löschen (nach DB-Commit): Rechnungs-PDFs, Rohtext, Avatar.
 *  5. Supabase-Auth-User hart löschen → Login dauerhaft unmöglich.
 *  6. Lokale Session beenden und zur Login-Seite leiten.
 *
 * Es bleiben KEINE soft-deleted Metadaten-Zeilen zurück.
 */
export async function deleteAccountAction(
  _prev: AccountDeletionState,
  formData: FormData,
): Promise<AccountDeletionState> {
  // GUARD: Ein lokaler/Dev-Prozess, der auf die gehostete Prod-Supabase
  // zeigt, darf NIEMALS Konten löschen. Genau so wurden am 2026-05-19 zwei
  // echte Accounts versehentlich gelöscht (npm run dev nutzt .env.local =
  // Prod-DB). Prod selbst läuft mit NODE_ENV=production und ist nicht
  // betroffen; geblockt wird nur „Dev/Test gegen gehostetes Supabase".
  if (
    /supabase\.co/i.test(process.env.DATABASE_URL ?? "") &&
    process.env.NODE_ENV !== "production"
  ) {
    console.error(
      "[deleteAccountAction] BLOCKED: non-production process targeting hosted Supabase — refusing destructive account deletion.",
    );
    return {
      status: "error",
      message:
        "Konto-Löschung in dieser Umgebung deaktiviert (Dev-Prozess auf Prod-DB). " +
        "Aus Sicherheitsgründen blockiert.",
    };
  }

  const auth = await requireCurrentAuth();
  const scopedSql = auth.scopedSql!;
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
    connections = await scopedSql<OrgConnectionRow[]>`
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

  // 2b. Storage-Pfade einsammeln BEVOR die DB-Zeilen verschwinden — der
  //     Hard-Delete in Schritt 3 entfernt invoice_files/invoices, danach
  //     ließen sich die Objektschlüssel nicht mehr ermitteln.
  const pdfPaths: string[] = [];
  const rawTextPaths: string[] = [];
  try {
    for (const org of soloOrgs) {
      const pdfRows = await scopedSql<{ storedPath: string }[]>`
        SELECT f.stored_path AS "storedPath"
        FROM invoice_files f
        INNER JOIN invoices i ON i.id = f.invoice_id
        WHERE i.organization_id = ${org.orgId}
      `;
      const rawRows = await scopedSql<{ rawTextPath: string | null }[]>`
        SELECT raw_text_path AS "rawTextPath"
        FROM invoices
        WHERE organization_id = ${org.orgId} AND raw_text_path IS NOT NULL
      `;
      for (const r of pdfRows) pdfPaths.push(r.storedPath);
      for (const r of rawRows) if (r.rawTextPath) rawTextPaths.push(r.rawTextPath);
    }
  } catch (error) {
    console.error("[deleteAccountAction] storage path collection failed:", error);
    return {
      status: "error",
      message:
        "Konto konnte nicht gelöscht werden. Bitte später erneut versuchen.",
    };
  }

  // Drift-Guard: welche migrations-späten organization_id-Spalten real
  // existieren (siehe getOptionalOrgColumns) — auf dem gedrifteten
  // Prod-Schema können sie fehlen.
  let optOrgCols: Set<string>;
  try {
    optOrgCols = await getOptionalOrgColumns();
  } catch (error) {
    console.error("[deleteAccountAction] column probe failed:", error);
    return {
      status: "error",
      message:
        "Konto konnte nicht gelöscht werden. Bitte später erneut versuchen.",
    };
  }

  // 3. DB-Transaktion: geordneter Child→Parent-Hard-Delete (geteilte Logik
  //    mit dem Login-Aufräumpfad). Schlägt etwas fehl, rollt alles zurück,
  //    in Storage ist noch nichts gelöscht und der Nutzer kann sich
  //    weiterhin einloggen → sauberer Fehler-Rückgabe.
  try {
    await unsafeGlobalSql.begin(async (tx) => {
      for (const org of soloOrgs) {
        await hardDeleteOrgData(tx, org.orgId, optOrgCols);
      }
      // Mitgliedschaften des Nutzers (auch in Fremd-Orgs) + User-Zeile hart.
      await tx`DELETE FROM org_members WHERE user_id = ${userId}`;
      await tx`DELETE FROM users WHERE id = ${userId}`;
      // DSGVO: magic_links speichern die E-Mail-Adresse im Klartext. Sie
      // gehören zum User (nicht zur Org) und müssen mit dem User verschwinden,
      // sonst bleibt die Mail-Adresse als "vergessenes Recht"-Verstoß stehen.
      // Tabelle ist seit dem Schema "magic_links" da, aber defensiv gegen
      // Schema-Drift mit einem dynamischen Check.
      const linksTableExists = await tx<{ t: string }[]>`
        SELECT table_name t FROM information_schema.tables
        WHERE table_schema = 'public' AND table_name = 'magic_links'
        LIMIT 1
      `;
      if (linksTableExists.length > 0) {
        await tx`DELETE FROM magic_links WHERE LOWER(email) = ${email}`;
      }
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
  //    weg). Best-effort: Fehler dürfen den Abschluss nicht blockieren, der
  //    unwiderrufliche Kern (DB) ist bereits erfolgt.
  try {
    for (const path of pdfPaths) {
      await deleteFromStorage(BUCKETS.INVOICES, path);
    }
    for (const path of rawTextPaths) {
      await deleteFromStorage(BUCKETS.RAW_TEXT, path);
    }
  } catch (error) {
    console.error("[deleteAccountAction] storage purge failed:", error);
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

  // 5. Supabase-Auth-User hart löschen. Schlägt das fehl, ist die
  //    Postgres-users-Zeile dennoch bereits hart gelöscht — ein erneuter
  //    Login würde via ensureUserProvisioned schlicht ein FRISCHES Konto
  //    anlegen (kein Wiederaufleben der alten Daten). Nur protokollieren.
  try {
    const admin = createSupabaseAdminClient();
    const { error } = await admin.auth.admin.deleteUser(authUserId);
    if (error) {
      console.error(
        "[deleteAccountAction] supabase deleteUser failed (postgres profile already hard-deleted; auth row needs manual cleanup):",
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
