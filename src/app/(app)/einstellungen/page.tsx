import { appConfig } from "@/lib/config/env";
import { getPrimaryMailAccount, getSecondaryMailAccount, listIntegrationTargets } from "@/lib/db/queries";
import {
  hasConfiguredCredential,
  hasStoredCredentialRef,
  isSecretStoreAvailable,
} from "@/lib/secrets/credential-store";
import { getProviderFromEmail } from "@/lib/mail-providers";
import { getExportTargets } from "@/exports/export-pipeline";
import { readJsonSetting } from "@/lib/db/settings-store";
import { MailboxConnectCard, type MailboxSlot } from "@/components/credentials/mailbox-connect-card";
import { StatusBadge } from "@/components/status/status-badge";
import { AddRecipientButton } from "@/components/einstellungen/recipient-modal";
import { clearExportTargetAction } from "@/app/(app)/einstellungen/actions";
import { ConfidenceSlider } from "@/components/einstellungen/confidence-slider";
import { SubjectTemplateCard } from "@/components/einstellungen/subject-template-card";
import { Tabs, type TabItem } from "@/components/ui/tabs";
import { Card } from "@/components/ui/card";
import { PageHeader } from "@/components/ui/page-header";
import { getCurrentAuth } from "@/lib/auth/current";
import { UsageCard } from "@/components/einstellungen/usage-card";
import { IntegrationsSection, type IntegrationStatus } from "@/components/einstellungen/integrations-section";
import { RetroactiveScanCard } from "@/components/einstellungen/retroactive-scan-card";
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
    imapPrimary,
    imapSecondary,
    primaryHasCredential,
    primaryHasRef,
    secondaryHasCredential,
    secondaryHasRef,
    integrationTargets,
    tier,
  ] = await Promise.all([
    getExportTargets(auth?.organization?.id ?? null),
    readJsonSetting<number>("auto_approve_confidence", appConfig.features.autoApprovalConfidenceThreshold),
    readJsonSetting<string>("invoice_subject_template", ""),
    getPrimaryMailAccount(),
    getSecondaryMailAccount(),
    hasConfiguredCredential("imap", "primary", auth?.organization?.id),
    hasStoredCredentialRef("imap", "primary", auth?.organization?.id),
    hasConfiguredCredential("imap", "secondary", auth?.organization?.id),
    hasStoredCredentialRef("imap", "secondary", auth?.organization?.id),
    listIntegrationTargets(auth?.organization?.id ?? null),
    getOrgTier(auth?.organization?.id ?? null),
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
      providerDomain: imapPrimary?.username ? (getProviderFromEmail(imapPrimary.username)?.domain ?? null) : null,
    },
    {
      key: "secondary",
      isConnected: secondaryHasCredential || secondaryHasRef,
      email: imapSecondary?.username ?? null,
      providerDomain: imapSecondary?.username ? (getProviderFromEmail(imapSecondary.username)?.domain ?? null) : null,
    },
  ];

  if (!keychainAvailable) {
    return (
      <div className="screen-enter screen-enter-active">
        <PageHeader
          title="Einstellungen"
          subline="Postfächer, Empfänger, Auto-Pilot und System."
        />
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
        <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-3 p-5">
          <div>
            <div className="text-sm font-medium text-ink">Empfänger für deine Buchhaltung</div>
            <div className="text-xs text-muted">
              Wohin wir Rechnungen senden — Standard wird automatisch gewählt.
            </div>
          </div>
          <AddRecipientButton />
        </div>
        {exportTargets.filter((t) => t.recipientEmail).length > 0 ? (
          <div className="divide-y divide-line border-t border-line">
            {exportTargets.filter((t) => t.recipientEmail).map((t, idx) => (
              <div key={t.id} className="flex items-center gap-3 px-5 py-3">
                <div className="min-w-0 flex-1">
                  <div className="text-sm font-medium text-ink truncate">{t.label}</div>
                  <div className="text-xs text-muted font-mono truncate">
                    {t.recipientEmail}
                  </div>
                </div>
                <StatusBadge
                  status={t.enabled ? "configured" : "disabled"}
                  label={idx === 0 ? "Standard" : "Sekundär"}
                />
                <form action={clearExportTargetAction}>
                  <input type="hidden" name="targetId" value={t.id} />
                  <button
                    type="submit"
                    className="text-xs text-muted underline underline-offset-4 decoration-line hover:text-danger"
                  >
                    entfernen
                  </button>
                </form>
              </div>
            ))}
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
            Gilt für alle Empfänger. Platzhalter werden pro Rechnung ersetzt; leer = interner Standard.
          </div>
          <SubjectTemplateCard initialValue={invoiceSubjectTemplate} />
        </div>
      </Card>

    </div>
  );

  // ─── Postfächer ─────────────────────────────────────────────────────────────

  const postfachTab = (
    <div className="space-y-4">
      <Card padding="none">
        <div className="p-5">
          <div className="mb-4 flex items-start justify-between gap-3">
            <div>
              <div className="text-sm font-medium text-ink">Postfächer (IMAP)</div>
              <div className="text-xs text-muted">
                Wähle deinen Anbieter — wir konfigurieren IMAP und SMTP automatisch.
              </div>
            </div>
            <a
              href="/onboarding?mode=edit"
              className="shrink-0 text-xs text-ink underline decoration-line underline-offset-4 hover:decoration-ink"
            >
              im Wizard bearbeiten →
            </a>
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
            <span className="text-xs font-medium text-muted">Konfidenz-Schwelle</span>
          </div>
          <ConfidenceSlider initialValue={confidenceThreshold} />
          <div className="mt-1 flex justify-between text-[11px] text-muted">
            <span>mehr Reviews · sicherer</span>
            <span>weniger Reviews · mutiger</span>
          </div>
        </div>
      </Card>

      <Card padding="lg">
        <div className="text-sm font-medium text-ink">Scan-Intervall</div>
        <div className="mt-0.5 text-xs text-muted">
          Infetch holt automatisch jede Stunde neue Mails ab.
        </div>
      </Card>

      <Card padding="lg">
        <div className="text-sm font-medium text-ink">KI-Backend</div>
        <div className="mb-4 mt-0.5 text-xs text-muted">
          Inklusive. Kein eigener Key nötig.
        </div>
        <div className="grid grid-cols-1 gap-3 text-xs md:grid-cols-3">
          <div className="rounded border border-line p-3">
            <div className="text-muted">Modell</div>
            <div className="mt-0.5 font-medium text-ink">EU-Hosted · OCR + Strukturextraktion</div>
          </div>
          <div className="rounded border border-line p-3">
            <div className="text-muted">Region</div>
            <div className="mt-0.5 font-medium text-ink">Frankfurt · DSGVO-konform</div>
          </div>
          <div className="rounded border border-line p-3">
            <div className="text-muted">Status</div>
            <div className="mt-1">
              <StatusBadge
                status={appConfig.mistral.enabled ? "configured" : "disabled"}
                label={appConfig.mistral.enabled ? "Ok" : "deaktiviert"}
              />
            </div>
          </div>
        </div>
      </Card>

      <Card padding="lg">
        <RetroactiveScanCard isPro={isPro} />
      </Card>

      <ScanHistoryCard />
    </div>
  );

  // ─── Tab assembly ────────────────────────────────────────────────────────────

  const integrationsTab = (
    <IntegrationsSection integrations={integrations} isPro={isPro} isBusiness={isBusiness} />
  );

  const tabs: TabItem[] = [
    { key: "buchhaltung",   label: "Buchhaltung",    content: buchhaltungTab   },
    { key: "postfach",      label: "Postfächer",      content: postfachTab      },
    { key: "integrationen", label: "Integrationen",   content: integrationsTab  },
    { key: "ki",            label: "KI & Auto-Pilot", content: aiTab            },
  ];

  return (
    <div className="screen-enter screen-enter-active">
      <PageHeader
        title="Einstellungen"
        subline="Postfächer, Empfänger und Auto-Pilot."
      />
      <Tabs tabs={tabs} defaultKey="buchhaltung" />
      <div className="mt-4">
        <UsageCard organizationId={auth?.organization?.id} />
      </div>
    </div>
  );
}
