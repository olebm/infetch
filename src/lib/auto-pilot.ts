import cron, { type ScheduledTask } from "node-cron";
import fs from "node:fs/promises";
import { unsafeGlobalSql as sql } from "@/lib/db/unsafe-global";
import { runPrimaryImapScan } from "@/mail/mail-scanner";
import { listOrgsWithConfiguredMailbox } from "@/mail/imap-client";
import { runMissingInvoiceCheck } from "@/invoices/missing-check";
import { dispatchPendingExports } from "@/exports/export-pipeline";
import { importPdfBuffer } from "@/invoices/import-pipeline";
import { runAgentForVendor } from "@/portals/agent/agent-connector";
import { notifyPortalFrictionIfNeeded } from "@/portals/agent/friction-notify";
import { syncCommunityRecipes } from "@/portals/agent/community-sync";
import { listPortalVendorKeysForCron, getPortalAccountOrg } from "@/portals/credential-meta";
import { getOrgTier, getLimits } from "@/lib/tier";
import { hasConfiguredCredential } from "@/lib/secrets/credential-store";
import { provisionAutoApprovalRules } from "@/lib/automation/self-provisioning";
import { reevaluateReviewQueue } from "@/lib/automation/reeval-queue";
import { cleanupIgnoredFiles } from "@/lib/automation/cleanup-ignored";
import { escalateStuckReviews } from "@/lib/automation/stuck-escalation";
import { backfillDomainAliases } from "@/lib/automation/alias-backfill";
import { runMonthlyReport } from "@/lib/automation/monthly-report";
import { runWeeklyDigest } from "@/lib/automation/weekly-digest";
import { runReactivationCheck } from "@/lib/automation/reactivation-check";
import { runWelcomeNudge } from "@/lib/automation/welcome-nudge";
import { appConfig } from "@/lib/config/env";

type JobName =
  | "mailScan"
  | "missingCheck"
  | "exportDispatch"
  | "portalFetch"
  | "communitySync"
  | "provisionRules"
  | "reevalQueue"
  | "cleanupIgnored"
  | "escalateStuck"
  | "backfillAliases"
  | "monthlyReport"
  | "weeklyDigest"
  | "reactivationCheck"
  | "welcomeNudge";

type JobState = {
  cron: string;
  task: ScheduledTask | null;
  lastRunAt: Date | null;
  lastError: string | null;
  running: boolean;
};

const jobs: Record<JobName, JobState> = {
  mailScan: { cron: "0 * * * *", task: null, lastRunAt: null, lastError: null, running: false },
  missingCheck: { cron: "0 6 * * *", task: null, lastRunAt: null, lastError: null, running: false },
  // Stündlich zur Minute :30 — zeitversetzt zum mailScan (:00), damit Abruf und
  // Versand nicht kollidieren und die Last über die Stunde verteilt ist. Bei
  // Freigabe (Onboarding-Abschluss / Review) wird zusätzlich sofort gedispatcht.
  exportDispatch: {
    cron: "30 * * * *",
    task: null,
    lastRunAt: null,
    lastError: null,
    running: false,
  },
  portalFetch: {
    cron: "0 */4 * * *",
    task: null,
    lastRunAt: null,
    lastError: null,
    running: false,
  },
  communitySync: {
    cron: "0 4 * * *",
    task: null,
    lastRunAt: null,
    lastError: null,
    running: false,
  },
  // Selbstheilungs-Jobs — laufen in dieser Reihenfolge nachts:
  // 1) Rules provisionieren basierend auf Bestand,
  // 2) Review-Queue mit neuen Rules erneut evaluieren,
  // 3) Disk-Müll aufräumen (wöchentlich).
  provisionRules: {
    cron: "0 3 * * *",
    task: null,
    lastRunAt: null,
    lastError: null,
    running: false,
  },
  reevalQueue: { cron: "0 5 * * *", task: null, lastRunAt: null, lastError: null, running: false },
  cleanupIgnored: {
    cron: "0 2 * * 0",
    task: null,
    lastRunAt: null,
    lastError: null,
    running: false,
  },
  // Stuck-Eskalation: täglich 1 Uhr — Rechnungen die zu lange im Review hängen → 'ignored'.
  escalateStuck: {
    cron: "0 1 * * *",
    task: null,
    lastRunAt: null,
    lastError: null,
    running: false,
  },
  // Alias-Backfill: täglich 4 Uhr — Domain-Aliase für Vendors die nur contains haben.
  backfillAliases: {
    cron: "0 4 * * *",
    task: null,
    lastRunAt: null,
    lastError: null,
    running: false,
  },
  // Monatlicher Report: am 1. jeden Monats um 8 Uhr — Zusammenfassung des Vormonats.
  monthlyReport: {
    cron: "0 8 1 * *",
    task: null,
    lastRunAt: null,
    lastError: null,
    running: false,
  },
  // Wöchentlicher Digest: montags um 8 Uhr — Zusammenfassung der letzten 7 Tage.
  weeklyDigest: { cron: "0 8 * * 1", task: null, lastRunAt: null, lastError: null, running: false },
  // Reaktivierungs-Check: sonntags um 9 Uhr — Nudge bei > 30 Tage Inaktivität.
  reactivationCheck: {
    cron: "0 9 * * 0",
    task: null,
    lastRunAt: null,
    lastError: null,
    running: false,
  },
  // Welcome-Nudge: alle 6h — Drop-outs ~24h nach Sign-Up einmalig erinnern.
  welcomeNudge: {
    cron: "0 */6 * * *",
    task: null,
    lastRunAt: null,
    lastError: null,
    running: false,
  },
};

let started = false;

async function runPortalFetch() {
  // Org-übergreifende Enumeration aus credential_refs (die Meta-Map ist seit 261
  // org-scoped). Die Org-Zuordnung + das Tier-Gating erledigt filterEntitledPortalAccounts.
  const allAccounts = await listPortalVendorKeysForCron();
  const accountsWithCreds = await Promise.all(
    allAccounts.map(async (entry) => ({
      entry,
      ok: await hasConfiguredCredential("portal", entry.vendorKey, entry.organizationId),
    })),
  );
  const accounts = accountsWithCreds.filter((a) => a.ok).map((a) => a.entry);
  if (accounts.length === 0) return;

  // Tier-Gating: nur Konten berechtigter Orgs innerhalb ihres Limits abrufen.
  const entitled = await filterEntitledPortalAccounts(accounts);
  if (entitled.length === 0) return;

  // Patchright (gepatchtes Chromium) statt Playwright — gleiche API, weniger
  // Bot-Detection. Lazy import, damit der Browser nur bei aktiven Portalen lädt.
  // Runtime aus patchright, Typen aus playwright → lokaler Cast (s. agent-connector).
  const { chromium: patchrightChromium } = await import("patchright");
  const chromium = patchrightChromium as unknown as typeof import("playwright").chromium;
  const sharedBrowser = await chromium.launch({
    headless: true,
    args: ["--disable-blink-features=AutomationControlled", "--disable-dev-shm-usage"],
  });

  try {
    for (const account of entitled) {
      try {
        const result = await runAgentForVendor({
          vendorKey: account.vendorKey,
          sharedBrowser,
        });
        for (const download of result.downloads) {
          try {
            const buffer = await fs.readFile(download.filePath);
            await importPdfBuffer({
              buffer,
              originalFilename: download.originalFilename,
              sourceType: "portal",
              sourceRefId: account.vendorKey,
            });
          } catch {
            // import-Fehler werden in portal_run_logs ohnehin protokolliert
          }
        }
        // Friktions-Benachrichtigung (INFETCH-257): braucht das Konto manuellen
        // Eingriff (CAPTCHA/2FA/Login), genau einmal den Org-Owner informieren.
        try {
          await notifyPortalFrictionIfNeeded({
            vendorKey: account.vendorKey,
            organizationId: account.organizationId,
            status: result.status,
          });
        } catch {
          // Benachrichtigung darf den Abruf nicht stören
        }
      } catch {
        // pro-Vendor-Fehler darf nicht den ganzen Job stoppen
      }
    }
  } finally {
    try {
      await sharedBrowser.close();
    } catch {
      // ignore
    }
  }
}

/**
 * Filtert Portal-Konten auf die, deren besitzende Org berechtigt ist und die
 * innerhalb ihres Online-Konten-Limits liegen (Free 0 / Pro 5 / Business 20).
 * Pro Org wird stabil nach updatedAt (älteste zuerst) sortiert; die ersten `max`
 * gelten als aktiv, der Rest wird übersprungen. So werden überzählige Konten nach
 * einem Downgrade automatisch nicht mehr abgerufen (Daten/Credentials bleiben).
 */
export async function filterEntitledPortalAccounts<
  T extends { vendorKey: string; updatedAt: string | null },
>(accounts: T[]): Promise<T[]> {
  const byOrg = new Map<string, T[]>();
  for (const account of accounts) {
    const orgId = await getPortalAccountOrg(account.vendorKey);
    if (!orgId) continue; // verwaistes Konto ohne Org → kein Abruf
    const list = byOrg.get(orgId) ?? [];
    list.push(account);
    byOrg.set(orgId, list);
  }

  const entitled: T[] = [];
  for (const [orgId, list] of byOrg) {
    const max = getLimits(await getOrgTier(orgId)).maxOnlineAccounts;
    if (max <= 0) continue; // keine Berechtigung (Free / nach Downgrade)
    const sorted = [...list].sort((a, b) => (a.updatedAt ?? "").localeCompare(b.updatedAt ?? ""));
    entitled.push(...sorted.slice(0, Number.isFinite(max) ? max : list.length));
  }
  return entitled;
}

// Multi-tenant Mail-Scan: pro Org mit konfiguriertem Postfach EIN eigener
// Scan (eigene sync_runs-Row + per-Org-Lock). Früher lief ein einziger
// globaler Scan, der via slot-collapse nur das Postfach EINER Org erwischte —
// alle anderen Tenants bekamen nie einen Auto-Abruf. Ein Fehler einer Org
// darf die anderen nicht stoppen (wird in deren sync_runs-Row festgehalten).
async function runMailScanAllOrgs() {
  const orgIds = await listOrgsWithConfiguredMailbox();
  for (const orgId of orgIds) {
    try {
      await runPrimaryImapScan({ limitToOrgId: orgId, triggeredBy: "schedule" });
    } catch {
      // pro-Org-Fehler isoliert; sichtbar in der org-eigenen sync_runs-Row
    }
  }
}

async function runJob(name: JobName) {
  const job = jobs[name];
  if (job.running) return;
  job.running = true;
  try {
    if (name === "mailScan") await runMailScanAllOrgs();
    else if (name === "missingCheck") await runMissingInvoiceCheck();
    else if (name === "exportDispatch") await dispatchPendingExports();
    else if (name === "portalFetch") await runPortalFetch();
    else if (name === "communitySync") await syncCommunityRecipes();
    else if (name === "provisionRules") await provisionAutoApprovalRules();
    else if (name === "reevalQueue") await reevaluateReviewQueue();
    else if (name === "cleanupIgnored") await cleanupIgnoredFiles();
    else if (name === "escalateStuck") await escalateStuckReviews();
    else if (name === "backfillAliases") await backfillDomainAliases();
    else if (name === "monthlyReport") await runMonthlyReport();
    else if (name === "weeklyDigest") await runWeeklyDigest();
    else if (name === "reactivationCheck") await runReactivationCheck();
    else if (name === "welcomeNudge") await runWelcomeNudge();
    job.lastRunAt = new Date();
    job.lastError = null;
  } catch (error) {
    job.lastError = error instanceof Error ? error.message : String(error);
    job.lastRunAt = new Date();
  } finally {
    job.running = false;
  }
}

function isJobEnabled(name: JobName): boolean {
  if (!appConfig.features.autoPilotEnabled) return false;
  if (name === "portalFetch") return appConfig.features.enablePortals;
  if (name === "communitySync") return appConfig.features.enableCommunityRecipes;
  if (name === "missingCheck") return appConfig.features.enableMissingMatrix;
  return true;
}

export function startAutoPilot() {
  if (started) return;
  started = true;

  // Stale 'running' sync_runs aufraeumen: stirbt der Prozess waehrend eines
  // Scans (Deploy mid-flight, OOM, kill), bleibt status='running' fuer immer
  // haengen — die UI zeigt dann einen ewig laufenden Scan. Beim Start alles
  // aelter als 15 Min als 'failed' markieren. Best-effort, darf den Start
  // nicht blockieren. (started_at ist TEXT → fuer den Vergleich casten.)
  sql`
    UPDATE sync_runs
    SET status = 'failed',
        finished_at = NOW()::TEXT,
        summary_json = '{"error":"process_died_before_completion"}'
    WHERE type = 'imap_scan'
      AND status = 'running'
      AND started_at IS NOT NULL
      AND started_at::timestamptz < NOW() - INTERVAL '15 minutes'
  `.catch(() => {
    /* best-effort: Cleanup darf den Auto-Pilot-Start nicht verhindern */
  });

  if (!appConfig.features.autoPilotEnabled) {
    return;
  }

  for (const name of Object.keys(jobs) as JobName[]) {
    if (!isJobEnabled(name)) continue;
    const job = jobs[name];
    job.task = cron.schedule(job.cron, () => {
      runJob(name).catch(() => {
        /* errors captured in job.lastError */
      });
    });
  }

  // Catch-up: trigger immediate mail-scan + export-dispatch on startup.
  // mailScan nur wenn auch ein IMAP-Account konfiguriert ist — sonst wirft der
  // Scanner "Kein konfiguriertes IMAP-Postfach vorhanden" und vergiftet sync_runs
  // mit einer failed-Row, die das Onboarding-Polling als "User-Scan gescheitert"
  // fehlinterpretiert (latest-row-Race).
  setTimeout(async () => {
    try {
      const orgIds = await listOrgsWithConfiguredMailbox();
      if (orgIds.length > 0) {
        runJob("mailScan").catch(() => {});
      }
    } catch {
      /* best-effort: catch-up darf scheitern */
    }
    runJob("exportDispatch").catch(() => {});
  }, 5_000);
}

export type AutoPilotStatus = {
  job: JobName;
  label: string;
  cron: string;
  lastRunAt: string | null;
  lastError: string | null;
  running: boolean;
  nextRunSec: number | null;
};

const JOB_LABELS: Record<JobName, string> = {
  mailScan: "Rechnungen abholen",
  missingCheck: "Was fehlt prüfen",
  exportDispatch: "An Buchhaltung verschicken",
  portalFetch: "Online-Konten prüfen",
  communitySync: "Community-Recipes synchronisieren",
  provisionRules: "Vendor-Regeln selbst anlegen",
  reevalQueue: "Review-Queue selbst heilen",
  cleanupIgnored: "Disk-Müll aufräumen",
  escalateStuck: "Vergessene Reviews abschließen",
  backfillAliases: "Vendor-Aliase ergänzen",
  monthlyReport: "Monatsbericht versenden",
  weeklyDigest: "Wöchentlichen Digest versenden",
  reactivationCheck: "Reaktivierungs-Check",
  welcomeNudge: "Onboarding-Erinnerung senden",
};

function nextCronTickSeconds(_cronExpr: string, _lastRunAt: Date | null): number | null {
  if (!_cronExpr) return null;
  const match = /^\*\/(\d+) \* \* \* \*$/.exec(_cronExpr);
  if (match) {
    const n = parseInt(match[1], 10);
    const now = new Date();
    const minutesNow = now.getMinutes();
    const remainder = n - (minutesNow % n);
    const next = new Date(now);
    next.setMinutes(minutesNow + remainder, 0, 0);
    return Math.max(0, Math.round((next.getTime() - now.getTime()) / 1000));
  }
  const minuteHourly = /^(\d+) \* \* \* \*$/.exec(_cronExpr);
  if (minuteHourly) {
    const minute = parseInt(minuteHourly[1], 10);
    const now = new Date();
    const next = new Date(now);
    next.setMinutes(minute, 0, 0);
    if (next <= now) next.setHours(now.getHours() + 1, minute, 0, 0);
    return Math.max(0, Math.round((next.getTime() - now.getTime()) / 1000));
  }
  const daily = /^0 (\d+) \* \* \*$/.exec(_cronExpr);
  if (daily) {
    const hour = parseInt(daily[1], 10);
    const now = new Date();
    const next = new Date(now);
    next.setHours(hour, 0, 0, 0);
    if (next <= now) next.setDate(next.getDate() + 1);
    return Math.max(0, Math.round((next.getTime() - now.getTime()) / 1000));
  }
  const everyNHours = /^0 \*\/(\d+) \* \* \*$/.exec(_cronExpr);
  if (everyNHours) {
    const n = parseInt(everyNHours[1], 10);
    const now = new Date();
    const hoursNow = now.getHours();
    const remainder = n - (hoursNow % n);
    const next = new Date(now);
    next.setHours(hoursNow + remainder, 0, 0, 0);
    return Math.max(0, Math.round((next.getTime() - now.getTime()) / 1000));
  }
  return null;
}

export function getAutoPilotStatus(): AutoPilotStatus[] {
  return (Object.keys(jobs) as JobName[])
    .filter((name) => isJobEnabled(name))
    .map((name) => ({
      job: name,
      label: JOB_LABELS[name],
      cron: jobs[name].cron,
      lastRunAt: jobs[name].lastRunAt ? jobs[name].lastRunAt!.toISOString() : null,
      lastError: jobs[name].lastError,
      running: jobs[name].running,
      nextRunSec: nextCronTickSeconds(jobs[name].cron, jobs[name].lastRunAt),
    }));
}
