import { CircleDot, ShieldCheck } from "lucide-react";
import { unsafeGlobalSql as sql } from "@/lib/db/unsafe-global";
import { listOnlineAccounts } from "@/portals/credential-meta";
import { getVendors } from "@/lib/db/queries";
import { getCurrentAuth } from "@/lib/auth/current";
import { hasStoredCredentialRef } from "@/lib/secrets/credential-store";
import { listRecipes } from "@/portals/agent/recipe-cache";
import { getCommunityRecipeStats } from "@/portals/agent/community-sync";
import { PORTAL_CATEGORIES, type PortalCategoryKey } from "@/vendors/registry";
import { AddOnlineAccountTrigger } from "@/components/online-accounts/add-online-account-trigger";
import { FetchNowButton, RemoveAccountButton } from "@/components/online-accounts/account-actions";
import { RecipeHealthButton } from "@/components/online-accounts/recipe-health-drawer";
import { CommunitySyncButton } from "@/components/online-accounts/community-sync-panel";
import { UpgradeCard } from "@/components/online-accounts/upgrade-card";
import { canAddOnlineAccount } from "@/lib/tier";

export async function OnlineAccountsView() {
  const auth = await getCurrentAuth();
  const orgId = auth?.organization?.id ?? null;
  const [accounts, recipes, allVendors, communityStats, accountLimit] = await Promise.all([
    listOnlineAccounts(),
    listRecipes(),
    getVendors(orgId),
    getCommunityRecipeStats(),
    canAddOnlineAccount(orgId),
  ]);
  const tier = accountLimit.tier;

  // Vendoren ohne Online-Konto (kommen aus Mail-Pipeline) — Kandidaten fuer "Online-Konto hinzufuegen"
  const vendorsWithoutAccount = allVendors.filter(
    (vendor) => !accounts.some((account) => account.vendorKey === vendor.canonicalKey),
  );

  // Fetch per-account data
  const accountData = await Promise.all(
    accounts.map(async (account) => {
      const [lastRunRows, runStatsRows, invoiceCountRows, hasTotp] = await Promise.all([
        sql<
          {
            status: string;
            startedAt: string;
            invoicesFound: number;
            errorMessage: string | null;
          }[]
        >`
          SELECT status, started_at AS "startedAt", invoices_found AS "invoicesFound",
            error_message AS "errorMessage"
          FROM portal_run_logs
          WHERE vendor_key = ${account.vendorKey}
          ORDER BY started_at DESC
          LIMIT 1
        `,
        sql<{ successCount: string; failureCount: string }[]>`
          SELECT
            SUM(CASE WHEN status IN ('success','no_invoices') THEN 1 ELSE 0 END)::text AS "successCount",
            SUM(CASE WHEN status NOT IN ('success','no_invoices') THEN 1 ELSE 0 END)::text AS "failureCount"
          FROM portal_run_logs WHERE vendor_key = ${account.vendorKey}
        `,
        sql<{ count: string }[]>`
          SELECT COUNT(*)::text AS count FROM invoices i
          JOIN vendors v ON v.id = i.vendor_id
          WHERE v.canonical_key = ${account.vendorKey} AND i.source = 'portal'
        `,
        hasStoredCredentialRef("totp", account.vendorKey),
      ]);

      return {
        account,
        lastRun: lastRunRows[0],
        successCount: Number(runStatsRows[0]?.successCount ?? 0),
        failureCount: Number(runStatsRows[0]?.failureCount ?? 0),
        invoiceCount: Number(invoiceCountRows[0]?.count ?? 0),
        hasTotp,
        recipe: recipes.find((r) => r.vendorKey === account.vendorKey && r.status === "active"),
      };
    }),
  );

  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between gap-4">
        <p className="text-sm text-muted">
          Wir holen Rechnungen automatisch aus diesen Konten ab. Du musst dich pro Konto nur einmal
          anmelden.
        </p>
        <AddOnlineAccountTrigger candidateVendors={vendorsWithoutAccount} />
      </div>
      <CommunitySyncButton stats={communityStats} />
      <UpgradeCard tier={tier} current={accountLimit.current} max={accountLimit.max} />

      {accounts.length === 0 ? (
        <div className="rounded border border-dashed border-line bg-surface px-6 py-10 text-center">
          <div className="text-sm font-semibold">Noch keine Online-Konten verbunden</div>
          <p className="mx-auto mt-2 max-w-md text-sm text-muted">
            Verbinde dein erstes Online-Konto — wir holen ab dann automatisch alle Rechnungen ab und
            legen sie in deinen Posteingang.
          </p>
        </div>
      ) : (
        <div className="space-y-2">
          {accountData.map(
            ({ account, lastRun, successCount, failureCount, invoiceCount, hasTotp, recipe }) => {
              const total = successCount + failureCount;
              const successRate = total > 0 ? Math.round((successCount / total) * 100) : null;
              const status = deriveStatus(lastRun);
              const categoryLabel = account.category
                ? PORTAL_CATEGORIES[account.category as PortalCategoryKey]?.label
                : null;

              return (
                <div
                  key={account.vendorKey}
                  className="flex flex-wrap items-center justify-between gap-3 rounded border border-line bg-white p-4 shadow-soft"
                >
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-semibold">{account.vendorName}</span>
                      {categoryLabel && <span className="text-xs text-muted">{categoryLabel}</span>}
                      {recipe && (
                        <span className="rounded bg-ok-soft px-1.5 py-0.5 text-xs text-ok">
                          Recipe v{recipe.version}
                        </span>
                      )}
                      {hasTotp && (
                        <span
                          className="inline-flex items-center gap-1 rounded bg-brand-soft px-1.5 py-0.5 text-xs text-brand-deep"
                          title="2FA-Schlüssel ist hinterlegt — der Code wird automatisch generiert."
                        >
                          <ShieldCheck className="h-3 w-3" aria-hidden />
                          2FA
                        </span>
                      )}
                      {successRate !== null && (
                        <span
                          className={`rounded px-1.5 py-0.5 text-xs ${
                            successRate >= 90
                              ? "bg-ok-soft text-ok"
                              : successRate >= 50
                                ? "bg-warn-soft text-warn"
                                : "bg-danger-soft text-danger"
                          }`}
                          title={`${successCount} erfolgreich von ${total} Läufen`}
                        >
                          {successRate}% erfolgreich
                        </span>
                      )}
                    </div>
                    <div className="mt-1 text-xs text-muted">{account.username}</div>
                    <div className="mt-2 flex flex-wrap items-center gap-3 text-xs text-muted">
                      <span className={`inline-flex items-center gap-1 ${status.color}`}>
                        <CircleDot className="h-3 w-3" aria-hidden />
                        {status.label}
                      </span>
                      {lastRun && <span>Zuletzt geprüft: {formatRelative(lastRun.startedAt)}</span>}
                      <span>
                        {invoiceCount} Rechnung{invoiceCount === 1 ? "" : "en"}
                      </span>
                      {account.loginUrl && (
                        <a
                          href={account.loginUrl}
                          target="_blank"
                          rel="noreferrer"
                          className="truncate text-muted hover:text-brand"
                          title={account.loginUrl}
                        >
                          Login-Seite öffnen
                        </a>
                      )}
                    </div>
                  </div>
                  <div className="flex shrink-0 gap-2">
                    <RecipeHealthButton
                      info={{
                        vendorKey: account.vendorKey,
                        vendorName: account.vendorName,
                        recipeVersion: recipe?.version ?? null,
                        recipeJson: recipe ? JSON.stringify(recipe.recipe, null, 2) : null,
                        recipeRecordedBy: recipe?.recordedBy ?? null,
                        successCount,
                        failureCount,
                        lastError: lastRun?.errorMessage ?? null,
                      }}
                    />
                    <FetchNowButton vendorKey={account.vendorKey} />
                    <RemoveAccountButton vendorKey={account.vendorKey} name={account.vendorName} />
                  </div>
                </div>
              );
            },
          )}
        </div>
      )}
    </div>
  );
}

function deriveStatus(lastRun: { status: string } | undefined): { label: string; color: string } {
  if (!lastRun) return { label: "Noch nicht geprüft", color: "text-muted" };
  if (lastRun.status === "success") return { label: "Verbunden", color: "text-ok" };
  if (lastRun.status === "no_invoices") return { label: "Verbunden", color: "text-ok" };
  if (lastRun.status === "login_required")
    return { label: "Login abgelaufen", color: "text-orange-700" };
  if (lastRun.status === "recipe_broken") return { label: "Anpassung läuft", color: "text-warn" };
  if (lastRun.status === "two_factor") return { label: "2FA-Code nötig", color: "text-orange-700" };
  if (lastRun.status === "captcha")
    return { label: "Bitte einmal manuell anmelden", color: "text-orange-700" };
  return { label: "Problem", color: "text-danger" };
}

function formatRelative(value: string): string {
  const ts = new Date(value.includes("T") ? value : value.replace(" ", "T") + "Z");
  if (Number.isNaN(ts.getTime())) return value;
  const diffSec = Math.round((Date.now() - ts.getTime()) / 1000);
  if (diffSec < 60) return "gerade eben";
  const diffMin = Math.round(diffSec / 60);
  if (diffMin < 60) return `vor ${diffMin} Min`;
  const diffH = Math.round(diffMin / 60);
  if (diffH < 24) return `vor ${diffH} Std`;
  const diffD = Math.round(diffH / 24);
  return `vor ${diffD} Tagen`;
}
