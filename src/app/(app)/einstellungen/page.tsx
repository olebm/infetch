import { appConfig } from "@/lib/config/env";
import {
  getPrimaryMailAccount,
  getSecondaryMailAccount,
  getPrimarySmtpAccount,
  getSecondarySmtpAccount,
  listIntegrationTargets,
} from "@/lib/db/queries";
import {
  hasConfiguredCredential,
  hasStoredCredentialRef,
  isSecretStoreAvailable,
} from "@/lib/secrets/credential-store";
import { getProviderFromEmail } from "@/lib/mail-providers";
import { getExportTargets } from "@/exports/export-pipeline";
import { readOrgJsonSetting } from "@/lib/db/settings-store";
import {
  MailboxConnectCard,
  type MailboxSlot,
} from "@/components/credentials/mailbox-connect-card";
import {
  SmtpAccountsSection,
  type SmtpAccountSlot,
} from "@/components/einstellungen/smtp-accounts-section";
import { StatusBadge } from "@/components/status/status-badge";
import {
  AddRecipientButton,
  EditRecipientButton,
} from "@/components/einstellungen/recipient-modal";
import { RemoveTargetButton } from "@/components/einstellungen/remove-target-button";
import { ConfidenceSlider } from "@/components/einstellungen/confidence-slider";
import { SubjectTemplateCard } from "@/components/einstellungen/subject-template-card";
import { PdfFilenameTemplateCard } from "@/components/einstellungen/pdf-filename-template-card";
import { Tabs, type TabItem } from "@/components/ui/tabs";
import { Card } from "@/components/ui/card";
import { PageHeader } from "@/components/ui/page-header";
import { getCurrentAuth } from "@/lib/auth/current";
import {
  IntegrationsSection,
  type IntegrationStatus,
} from "@/components/einstellungen/integrations-section";
import { ScanHistoryCard } from "@/components/einstellungen/scan-history-card";
import { getOrgTier } from "@/lib/tier";

export const dynamic = "force-dynamic";

export default async function SetupPage() {
  const auth = await getCurrentAuth();
  const keychainAvailable = isSecretStoreAvailable();

  const [
    exportTargets,
    confidenceThreshold,
    invoiceSubjectTemplate,
    pdfFilenameTemplate,
    imapPrimary,
    imapSecondary,
    primaryHasCredential,
    primaryHasRef,
    secondaryHasCredential,
    secondaryHasRef,
    integrationTargets,
    tier,
    smtpPrimary,
    smtpSecondary,
    smtpSecondaryHasCredential,
    smtpSecondaryHasRef,
  ] = await Promise.all([
    getExportTargets(auth?.organization?.id ?? null),
    readOrgJsonSetting<number>(
      "auto_approve_confidence",
      auth?.organization?.id ?? null,
      appConfig.features.autoApprovalConfidenceThreshold,
    ),
    readOrgJsonSetting<string>("invoice_subject_template", auth?.organization?.id ?? null, ""),
    readOrgJsonSetting<string>("pdf_filename_template", auth?.organization?.id ?? null, ""),
    getPrimaryMailAccount(auth?.organization?.id ?? null),
    getSecondaryMailAccount(auth?.organization?.id ?? null),
    hasConfiguredCredential("imap", "primary", auth?.organization?.id),
    hasStoredCredentialRef("imap", "primary", auth?.organization?.id),
    hasConfiguredCredential("imap", "secondary", auth?.organization?.id),
    hasStoredCredentialRef("imap", "secondary", auth?.organization?.id),
    listIntegrationTargets(auth?.organization?.id ?? null),
    getOrgTier(auth?.organization?.id ?? null),
    getPrimarySmtpAccount(auth?.organization?.id ?? null),
    getSecondarySmtpAccount(auth?.organization?.id ?? null),
    hasConfiguredCredential("smtp", "secondary", auth?.organization?.id),
    hasStoredCredentialRef("smtp", "secondary", auth?.organization?.id),
  ]);

  const isPro = tier !== "free";
  const isBusiness = tier === "business";

  const integrations: IntegrationStatus[] = integrationTargets.map((t) => ({
    provider: t.provider as IntegrationStatus["provider"],
    enabled: t.enabled,
    label: t.label,
    externalAccountId: t.externalAccountId,
    lastVerifiedAt: t.lastVerifiedAt,
  }));

  const mailboxSlots: MailboxSlot[] = [
    {
      key: "primary",
      isConnected: primaryHasCredential || primaryHasRef,
      email: imapPrimary?.username ?? null,
      providerDomain: imapPrimary?.username
        ? (getProviderFromEmail(imapPrimary.username)?.domain ?? null)
        : null,
      servers:
        imapPrimary || smtpPrimary
          ? {
              imapHost: imapPrimary?.host,
              imapPort: imapPrimary?.port,
              imapSecure: imapPrimary ? Boolean(imapPrimary.secure) : undefined,
              smtpHost: smtpPrimary?.host,
              smtpPort: smtpPrimary?.port,
              smtpSecure: smtpPrimary?.secure,
            }
          : undefined,
    },
    {
      key: "secondary",
      isConnected: secondaryHasCredential || secondaryHasRef,
      email: imapSecondary?.username ?? null,
      providerDomain: imapSecondary?.username
        ? (getProviderFromEmail(imapSecondary.username)?.domain ?? null)
        : null,
      servers:
        imapSecondary || smtpSecondary
          ? {
              imapHost: imapSecondary?.host,
              imapPort: imapSecondary?.port,
              imapSecure: imapSecondary ? Boolean(imapSecondary.secure) : undefined,
              smtpHost: smtpSecondary?.host,
              smtpPort: smtpSecondary?.port,
              smtpSecure: smtpSecondary?.secure,
            }
          : undefined,
    },
  ];

  // Absende-Konten (SMTP) — getrennt von IMAP. Primary existiert nach Onboarding
  // immer (Fallback auf IMAP-Credentials), secondary ist optional.
  const smtpAccountSlots: SmtpAccountSlot[] = [
    {
      slot: "primary",
      fromAddress: smtpPrimary?.fromAddress ?? null,
      username: smtpPrimary?.username ?? null,
      configured: Boolean(smtpPrimary),
      providerDomain: smtpPrimary?.fromAddress
        ? (getProviderFromEmail(smtpPrimary.fromAddress)?.domain ?? null)
        : null,
      servers: smtpPrimary
        ? { smtpHost: smtpPrimary.host, smtpPort: smtpPrimary.port, smtpSecure: smtpPrimary.secure }
        : undefined,
    },
    {
      slot: "secondary",
      fromAddress: smtpSecondary?.fromAddress ?? null,
      username: smtpSecondary?.username ?? null,
      configured: Boolean(smtpSecondary) && (smtpSecondaryHasCredential || smtpSecondaryHasRef),
      providerDomain: smtpSecondary?.fromAddress
        ? (getProviderFromEmail(smtpSecondary.fromAddress)?.domain ?? null)
        : null,
      servers: smtpSecondary
        ? {
            smtpHost: smtpSecondary.host,
            smtpPort: smtpSecondary.port,
            smtpSecure: smtpSecondary.secure,
          }
        : undefined,
    },
  ];

  // Nur konfigurierte Konten als Zuweisungs-Optionen für Empfänger.
  const smtpOptions = smtpAccountSlots
    .filter((s) => s.configured && s.fromAddress)
    .map((s) => ({ slot: s.slot, fromAddress: s.fromAddress as string }));

  if (!keychainAvailable) {
    return (
      <div className="screen-enter screen-enter-active">
        <PageHeader title="Einstellungen" subline="Postfächer, Empfänger, Auto-Pilot und System." />
        <div className="rounded-md border border-warn/20 bg-warn-soft p-4 text-sm text-ink">
          Sichere Eingabe ist auf diesem System nicht verfügbar. Nutze{" "}
          <code className="font-mono">.env.local</code>.
        </div>
      </div>
    );
  }

  // ─── Buchhaltung ────────────────────────────────────────────────────────────

  const buchhaltungTab = (
    <div className="space-y-4">
      <Card padding="none">
        <div className="p-5">
          <div className="mb-4">
            <div className="text-sm font-medium text-ink">Absende-Konten (SMTP)</div>
            <div className="text-xs text-muted">
              Von dieser Adresse leiten wir deine Rechnungen weiter. Manche Buchhaltungs-Apps
              erkennen dich am Absender — für zwei Empfänger kannst du zwei Absende-Konten
              hinterlegen.
            </div>
          </div>
          <SmtpAccountsSection slots={smtpAccountSlots} />
        </div>
      </Card>

      <Card padding="none">
        <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-3 p-5">
          <div>
            <div className="text-sm font-medium text-ink">Empfänger für deine Buchhaltung</div>
            <div className="text-xs text-muted">
              Wohin wir Rechnungen senden — Standard wird automatisch gewählt.
            </div>
          </div>
          <AddRecipientButton smtpOptions={smtpOptions} />
        </div>
        {exportTargets.filter((t) => t.recipientEmail).length > 0 ? (
          <div className="divide-y divide-line border-t border-line">
            {exportTargets
              .filter((t) => t.recipientEmail)
              .map((t, idx) => {
                const sendFrom =
                  smtpAccountSlots.find((s) => s.slot === t.smtpSlot && s.configured)
                    ?.fromAddress ?? null;
                return (
                  <div key={t.id} className="flex items-center gap-3 px-5 py-3">
                    <div className="min-w-0 flex-1">
                      <div className="text-sm font-medium text-ink truncate">{t.label}</div>
                      <div className="text-xs text-muted font-mono truncate">
                        {t.recipientEmail}
                      </div>
                      {sendFrom && (
                        <div className="text-[11px] text-muted truncate">
                          sendet von: <span className="font-mono">{sendFrom}</span>
                        </div>
                      )}
                    </div>
                    <StatusBadge
                      status={t.enabled ? "configured" : "disabled"}
                      label={idx === 0 ? "Primär" : "Sekundär"}
                    />
                    <EditRecipientButton
                      target={{
                        target: t.target,
                        label: t.label,
                        recipientEmail: t.recipientEmail,
                        smtpSlot: t.smtpSlot,
                        enabled: t.enabled,
                      }}
                      smtpOptions={smtpOptions}
                    />
                    <RemoveTargetButton targetId={String(t.id)} />
                  </div>
                );
              })}
          </div>
        ) : (
          <div className="border-t border-line px-5 py-4 text-sm text-muted">
            Noch keine Empfänger eingerichtet.
          </div>
        )}
      </Card>

      <Card padding="none">
        <div className="p-5">
          <div className="mb-1 text-sm font-medium text-ink">Betreff der Weiterleitung</div>
          <div className="mb-4 text-xs text-muted">
            Gilt für alle Empfänger. Platzhalter werden pro Rechnung ersetzt; leer = interner
            Standard.
          </div>
          <SubjectTemplateCard initialValue={invoiceSubjectTemplate} />
        </div>
      </Card>

      <Card padding="none">
        <div className="p-5">
          <div className="mb-1 text-sm font-medium text-ink">Dateiname der Rechnungs-PDFs</div>
          <div className="mb-4 text-xs text-muted">
            Gilt beim Weiterleiten per E-Mail und beim ZIP-Download. Leer = Originalname behalten.
          </div>
          <PdfFilenameTemplateCard initialValue={pdfFilenameTemplate} />
        </div>
      </Card>
    </div>
  );

  // ─── Postfächer ─────────────────────────────────────────────────────────────

  const postfachTab = (
    <div className="space-y-4">
      <Card padding="none">
        <div className="p-5">
          <div className="mb-4">
            <div className="text-sm font-medium text-ink">Postfächer (IMAP)</div>
            <div className="text-xs text-muted">
              Wähle deinen Anbieter — wir konfigurieren den Empfang automatisch.
            </div>
          </div>
          <MailboxConnectCard slots={mailboxSlots} isPro={isPro} />
        </div>
      </Card>
    </div>
  );

  // ─── KI & Auto-Pilot ────────────────────────────────────────────────────────

  const autoPilotOn = appConfig.features.autoPilotEnabled;
  const aiTab = (
    <div className="space-y-4">
      <Card padding="lg">
        <div className="flex items-center justify-between">
          <div>
            <div className="text-sm font-medium text-ink">Auto-Pilot</div>
            <div className="text-xs text-muted">
              Sichere Treffer direkt versenden — du wirst nur bei Unsicherheit gefragt.
            </div>
          </div>
          {/* Read-only Status (gesteuert ueber env var AUTO_PILOT_ENABLED).
              Echter User-Toggle separat als Folge-Issue. */}
          <StatusBadge
            status={autoPilotOn ? "configured" : "disabled"}
            label={autoPilotOn ? "aktiv" : "inaktiv"}
          />
        </div>
        <div className="mt-5 border-t border-line pt-4">
          <div className="mb-2 flex items-center justify-between">
            <span className="text-xs font-medium text-muted">Empfindlichkeit</span>
          </div>
          <ConfidenceSlider initialValue={confidenceThreshold} />
          <div className="mt-1 flex justify-between text-[11px] text-muted">
            <span>mehr Reviews · sicherer</span>
            <span>weniger Reviews · mutiger</span>
          </div>
        </div>
      </Card>

      <Card padding="lg">
        <div className="text-sm font-medium text-ink">KI</div>
        <div className="mb-4 mt-0.5 text-xs text-muted">Inklusive. Kein eigener Key nötig.</div>
        <div className="grid grid-cols-1 gap-3 text-xs md:grid-cols-3">
          <div className="rounded border border-line p-3">
            <div className="text-muted">Status</div>
            <div className="mt-1">
              <StatusBadge
                status={appConfig.mistral.enabled ? "configured" : "disabled"}
                label={appConfig.mistral.enabled ? "Ok" : "deaktiviert"}
              />
            </div>
          </div>
          <div className="rounded border border-line p-3">
            <div className="text-muted">Modell</div>
            <div className="mt-0.5 font-medium text-ink">EU-Hosted</div>
          </div>
          <div className="rounded border border-line p-3">
            <div className="text-muted">Region</div>
            <div className="mt-0.5 font-medium text-ink">Frankfurt · DSGVO-konform</div>
          </div>
        </div>
      </Card>

      <ScanHistoryCard organizationId={auth?.organization?.id ?? null} />
    </div>
  );

  // ─── Tab assembly ────────────────────────────────────────────────────────────

  const integrationsTab = (
    <IntegrationsSection integrations={integrations} isPro={isPro} isBusiness={isBusiness} />
  );

  const tabs: TabItem[] = [
    { key: "postfach", label: "Postfächer", content: postfachTab },
    { key: "buchhaltung", label: "Buchhaltung", content: buchhaltungTab },
    // Integrationen (lexoffice/sevDesk) erst einblenden, wenn der Pro-Tarif
    // aktiviert ist — im Free-only-Launch ausgeblendet.
    ...(appConfig.billing.proEnabled
      ? [{ key: "integrationen", label: "Integrationen", content: integrationsTab }]
      : []),
    { key: "ki", label: "Auto-Pilot", content: aiTab },
  ];

  return (
    <div className="screen-enter screen-enter-active">
      <PageHeader title="Einstellungen" subline="Postfächer, Empfänger und Auto-Pilot." />
      <Tabs tabs={tabs} defaultKey="postfach" />
    </div>
  );
}
