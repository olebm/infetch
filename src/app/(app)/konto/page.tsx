import { getInvoiceYears, getVendors } from "@/lib/db/queries";
import { getCurrentAuth } from "@/lib/auth/current";
import {
  loadOrgMembers,
  loadUserOrganizations,
  getUserProfileFields,
  loadPendingInvitations,
} from "@/lib/auth/session";
import { ExportDownloadCard } from "@/components/einstellungen/export-download-card";
import { UsageCard } from "@/components/einstellungen/usage-card";
import { getOrgTier, getLimits } from "@/lib/tier";
import { ProfilForm } from "@/components/einstellungen/profil-form";
import { SwitchOrgButton } from "@/components/einstellungen/sessions-section";
import { MembersCard } from "@/components/konto/members-card";
import { BillingCard } from "@/components/konto/billing-card";
import { Card } from "@/components/ui/card";
import { PageHeader } from "@/components/ui/page-header";
import { StatusBadge } from "@/components/status/status-badge";
import { VendorLogo } from "@/components/ui/vendor-logo";
import { unsafeGlobalSql } from "@/lib/db/unsafe-global";

export const dynamic = "force-dynamic";

function planLabel(tier: string, priceEur: number) {
  if (tier === "free") return "Free · kostenlos";
  return `${tier.charAt(0).toUpperCase() + tier.slice(1)} · ${priceEur} € / Monat`;
}

export default async function KontoPage() {
  const auth = await getCurrentAuth();
  const orgId = auth?.organization?.id ?? null;

  const [
    invoiceYears,
    vendors,
    userOrgs,
    orgMembers,
    pendingInvitations,
    profileFields,
    tier,
    orgRow,
  ] = await Promise.all([
    getInvoiceYears(orgId),
    getVendors(orgId),
    auth ? loadUserOrganizations(auth.user.id) : Promise.resolve([]),
    auth?.organization ? loadOrgMembers(auth.organization.id) : Promise.resolve([]),
    auth?.organization ? loadPendingInvitations(auth.organization.id) : Promise.resolve([]),
    auth ? getUserProfileFields(auth.user.id) : Promise.resolve(null),
    getOrgTier(orgId),
    orgId
      ? unsafeGlobalSql<
          { stripe_customer_id: string | null }[]
        >`SELECT stripe_customer_id FROM organizations WHERE id = ${orgId} LIMIT 1`.catch(
          () => [] as { stripe_customer_id: string | null }[],
        )
      : Promise.resolve([] as { stripe_customer_id: string | null }[]),
  ]);

  const hasStripeCustomer = Boolean(
    (orgRow as { stripe_customer_id: string | null }[])[0]?.stripe_customer_id,
  );

  const isPro = tier !== "free";
  const limits = getLimits(tier);

  // Aktuelle Mitglieder-Rolle des eingeloggten Nutzers ermitteln
  const currentUserRole = orgMembers.find((m) => m.userId === auth?.user?.id)?.role ?? "member";

  return (
    <div className="screen-enter screen-enter-active">
      <PageHeader title="Mein Konto" subline="Profil, Arbeitsbereich und Paket." />

      <div className="mt-8 space-y-4">
        {/* 1 ── Dein Profil ─────────────────────────────────────────────────── */}
        <Card padding="lg">
          <div className="mb-3 text-sm font-medium text-ink">Dein Profil</div>
          <ProfilForm
            initialName={auth?.user?.name ?? ""}
            initialEmail={auth?.user?.email ?? ""}
            initialCompanyName={profileFields?.companyName ?? ""}
            initialVatId={profileFields?.vatId ?? ""}
            initialAvatarUrl={profileFields?.avatarUrl ?? null}
          />
        </Card>

        {/* 1b ── Nutzung diesen Monat (unter „Dein Profil") ─────────────────── */}
        <UsageCard organizationId={orgId} />

        {/* 2 ── Arbeitsbereich — nur bei Business (Multi-Org) oder tatsächlich mehreren Orgs */}
        {(tier === "business" || userOrgs.length > 1) && (
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
                        {org.slug} ·{" "}
                        {planLabel(
                          org.tier,
                          getLimits(org.tier as "free" | "pro" | "business").priceMonthlyEur,
                        )}
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
                <li className="px-5 py-3 text-sm text-muted">Kein Arbeitsbereich gefunden.</li>
              )}
            </ul>
          </Card>
        )}

        {/* 3 ── Mitglieder — nur Pro/Business (Free = Einzelnutzer) ──────────── */}
        {isPro && (
          <Card padding="none">
            <MembersCard
              members={orgMembers}
              pendingInvitations={pendingInvitations}
              currentUserId={auth?.user?.id ?? ""}
              currentUserRole={currentUserRole}
              orgName={auth?.organization?.name ?? ""}
              maxUsers={limits.maxUsers}
              isPro={isPro}
            />
          </Card>
        )}

        {/* 4 ── Paket ──────────────────────────────────────────────────────── */}
        <BillingCard tier={tier} limits={limits} hasStripeCustomer={hasStripeCustomer} />

        {/* 5 ── Daten & Konto ───────────────────────────────────────────────── */}
        <ExportDownloadCard
          years={invoiceYears}
          vendors={vendors.map((v) => ({ id: v.id, name: v.name }))}
          isPro={isPro}
          email={auth?.user?.email ?? ""}
        />
      </div>
    </div>
  );
}
