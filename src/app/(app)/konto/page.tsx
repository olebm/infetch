import { getInvoiceYears } from "@/lib/db/queries";
import { getCurrentAuth } from "@/lib/auth/current";
import { loadOrgMembers, loadUserOrganizations, loadActiveSessions, getUserProfileFields } from "@/lib/auth/session";
import { ExportDownloadCard } from "@/components/einstellungen/export-download-card";
import { ProfilForm } from "@/components/einstellungen/profil-form";
import { SessionsSection, SwitchOrgButton } from "@/components/einstellungen/sessions-section";
import { Card } from "@/components/ui/card";
import { PageHeader } from "@/components/ui/page-header";
import { StatusBadge } from "@/components/status/status-badge";
import { VendorLogo } from "@/components/ui/vendor-logo";

export const dynamic = "force-dynamic";

function roleLabel(role: string) {
  if (role === "owner") return "Inhaber";
  if (role === "admin") return "Bearbeiter";
  return "Nur lesen";
}

function planLabel(tier: string) {
  if (tier === "pro") return "Pro · 9 € / Monat";
  return "Solo · kostenlos";
}

function initials(name: string | null, email: string) {
  if (name) {
    const parts = name.trim().split(/\s+/);
    return (parts[0]?.[0] ?? "") + (parts[1]?.[0] ?? "");
  }
  return email.slice(0, 2).toUpperCase();
}

export default async function KontoPage() {
  const auth = await getCurrentAuth();
  const [invoiceYears, userOrgs, orgMembers, activeSessions, profileFields] = await Promise.all([
    getInvoiceYears(),
    auth ? loadUserOrganizations(auth.user.id) : Promise.resolve([]),
    auth?.organization ? loadOrgMembers(auth.organization.id) : Promise.resolve([]),
    auth ? loadActiveSessions(auth.user.id) : Promise.resolve([]),
    auth ? getUserProfileFields(auth.user.id) : Promise.resolve(null),
  ]);

  return (
    <div className="screen-enter screen-enter-active">
      <PageHeader
        title="Mein Konto"
        subline="Profil, Arbeitsbereich, Sicherheit und Abrechnung."
      />

      <div className="mt-8 space-y-4">

        {/* ── Dein Profil ───────────────────────────────────────────────────── */}
        <Card padding="lg">
          <div className="mb-3 text-sm font-medium text-ink">Dein Profil</div>
          <ProfilForm
            initialName={auth?.user?.name ?? ""}
            initialEmail={auth?.user?.email ?? ""}
            initialCompanyName={profileFields?.companyName ?? ""}
            initialVatId={profileFields?.vatId ?? ""}
          />
        </Card>

        {/* ── Sicherheit ────────────────────────────────────────────────────── */}
        <Card padding="lg">
          <div className="mb-3 text-sm font-medium text-ink">Sicherheit</div>
          <ul className="divide-y divide-line border-y border-line">
            <li className="flex items-center gap-3 py-3">
              <div className="flex-1">
                <div className="text-sm text-ink">Magic-Link</div>
                <div className="text-xs text-muted">Login per E-Mail — kein Passwort.</div>
              </div>
              <StatusBadge status="configured" label="aktiv" />
            </li>
            <li className="flex items-center gap-3 py-3">
              <div className="flex-1">
                <div className="text-sm text-ink">Zwei-Faktor (TOTP)</div>
                <div className="text-xs text-muted">
                  Empfohlen, wenn mehrere Personen Zugriff haben.
                </div>
              </div>
              <span className="text-xs text-muted">geplant</span>
            </li>
            <SessionsSection
              sessionCount={activeSessions.length}
              lastUsedAt={activeSessions[0]?.lastUsedAt ?? null}
            />
          </ul>
        </Card>

        {/* ── Arbeitsbereich ────────────────────────────────────────────────── */}
        <Card padding="none">
          <div className="flex items-start justify-between gap-4 p-5">
            <div>
              <div className="text-sm font-medium text-ink">Arbeitsbereich</div>
              <div className="text-xs text-muted">
                Jede Organisation hat eigene Postfächer, Anbieter und Mitglieder.
              </div>
            </div>
          </div>
          <ul className="divide-y divide-line border-t border-line">
            {userOrgs.map((org) => {
              const isCurrent = org.id === auth?.organization?.id;
              return (
                <li key={org.id} className="flex items-center gap-3 px-5 py-3">
                  <VendorLogo name={org.name} size={32} className="shrink-0" />
                  <div className="min-w-0 flex-1">
                    <div className="text-sm font-medium text-ink">{org.name}</div>
                    <div className="text-xs text-muted">
                      {org.slug} · {planLabel(org.tier)}
                    </div>
                  </div>
                  {isCurrent ? (
                    <StatusBadge status="configured" label="aktiv" />
                  ) : (
                    <SwitchOrgButton orgId={org.id} />
                  )}
                </li>
              );
            })}
            {userOrgs.length === 0 && (
              <li className="px-5 py-3 text-sm text-muted">
                Kein Arbeitsbereich gefunden.
              </li>
            )}
          </ul>
        </Card>

        {/* ── Mitglieder ────────────────────────────────────────────────────── */}
        <Card padding="none">
          <div className="flex items-start justify-between gap-4 p-5">
            <div>
              <div className="text-sm font-medium text-ink">
                Mitglieder{auth?.organization ? ` · ${auth.organization.name}` : ""}
              </div>
              <div className="text-xs text-muted">
                Wer sieht und bearbeitet Rechnungen in diesem Arbeitsbereich.
              </div>
            </div>
          </div>
          <ul className="divide-y divide-line border-t border-line">
            {orgMembers.map((m) => {
              const isMe = m.userId === auth?.user?.id;
              return (
                <li key={m.userId} className="flex items-center gap-3 px-5 py-3">
                  <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-ink text-[11px] font-medium text-white">
                    {initials(m.name, m.email)}
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm font-medium text-ink">
                      {m.name || m.email}
                      {isMe && <span className="ml-2 text-xs text-muted">(du)</span>}
                    </div>
                    <div className="truncate text-xs text-muted">{m.email}</div>
                  </div>
                  <span className="text-xs text-muted">{roleLabel(m.role)}</span>
                </li>
              );
            })}
            {orgMembers.length === 0 && (
              <li className="px-5 py-3 text-sm text-muted">
                Keine Mitglieder gefunden.
              </li>
            )}
          </ul>
        </Card>

        {/* ── Abrechnung ────────────────────────────────────────────────────── */}
        <Card padding="lg">
          <div className="flex items-start justify-between gap-4">
            <div>
              <div className="text-sm font-medium text-ink">Abrechnung</div>
              <div className="text-xs text-muted">
                {auth?.organization ? planLabel(auth.organization.tier) : "Solo · kostenlos"}
              </div>
            </div>
          </div>
        </Card>

        {/* ── Daten & Konto ─────────────────────────────────────────────────── */}
        <ExportDownloadCard years={invoiceYears} />

        {/* ── Demnächst ─────────────────────────────────────────────────────── */}
        <Card padding="lg">
          <div className="mb-3 text-sm font-medium text-ink">Demnächst</div>
          <ul className="space-y-2">
            {[
              { label: "Zwei-Faktor-Auth (TOTP)",    detail: "Zusätzlicher Login-Schutz per Authenticator-App" },
              { label: "Mitglieder einladen",         detail: "Teammitglieder in den Arbeitsbereich holen" },
              { label: "Rollen & Berechtigungen",     detail: "Differenzierter Zugriff für Inhaber, Bearbeiter und Lesende" },
              { label: "Weitere Arbeitsbereiche",     detail: "Mehrere Organisationen unter einem Account verwalten" },
              { label: "Abrechnung & Rechnungen",     detail: "Plan wechseln und Rechnungsbelege herunterladen" },
            ].map((item) => (
              <li key={item.label} className="flex items-start gap-3">
                <span className="mt-0.5 inline-block h-1.5 w-1.5 shrink-0 rounded-full bg-line" aria-hidden />
                <div>
                  <div className="text-sm text-ink">{item.label}</div>
                  <div className="text-xs text-muted">{item.detail}</div>
                </div>
              </li>
            ))}
          </ul>
        </Card>

      </div>
    </div>
  );
}
