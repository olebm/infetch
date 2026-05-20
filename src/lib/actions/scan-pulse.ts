"use server";

import { getAutoPilotStatus } from "@/lib/auto-pilot";
import { getAutomationStats } from "@/lib/db/queries";
import { getCurrentAuth } from "@/lib/auth/current";

export type HeroFreshPulse = {
  mailScanRunning: boolean;
  nextRunSec: number | null;
  exportedLifetime: number;
};

// Live-Daten fuer den HeroFresh-Pulse: ob der mailScan-Job gerade laeuft,
// wieviel Sekunden bis zum naechsten Cron-Tick, und ob mittlerweile schon
// die erste Rechnung importiert wurde. Letzteres triggert clientseitig ein
// router.refresh() → AutoPilotHero rendert dann HeroRunning statt HeroFresh.
export async function getHeroFreshPulseAction(): Promise<HeroFreshPulse> {
  const auth = await getCurrentAuth();
  const orgId = auth?.organization?.id ?? null;
  const status = getAutoPilotStatus();
  const stats = await getAutomationStats(orgId);
  const mailScan = status.find((s) => s.job === "mailScan");
  return {
    mailScanRunning: mailScan?.running ?? false,
    nextRunSec: mailScan?.nextRunSec ?? null,
    exportedLifetime: stats.exportedLifetime,
  };
}
