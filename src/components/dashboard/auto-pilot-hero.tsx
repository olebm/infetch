import Link from "next/link";
import { ArrowRight, Check } from "lucide-react";
import { appConfig } from "@/lib/config/env";
import { getAutoPilotStatus } from "@/lib/auto-pilot";
import { getAutomationStats, getSetupSnapshot, getPrimaryMailAccount } from "@/lib/db/queries";
import { getExportTargets } from "@/exports/export-pipeline";
import { getCurrentAuth } from "@/lib/auth/current";
import { HeroFreshLive } from "@/components/dashboard/hero-fresh-live";
import type { HeroFreshPulse } from "@/lib/actions/scan-pulse";
import { ScanButton } from "@/components/invoice-inbox/scan-button";

type Setup = Awaited<ReturnType<typeof getSetupSnapshot>>;

interface AutoPilotHeroProps {
  setup?: Setup;
}

function formatCountdown(sec: number | null): string {
  if (sec === null || sec === undefined) return "—";
  if (sec < 60) return `${sec} Sek`;
  const min = Math.floor(sec / 60);
  const remSec = sec % 60;
  if (min < 60) return `${min}:${String(remSec).padStart(2, "0")}`;
  const h = Math.round(min / 60);
  return `${h} Std`;
}

/**
 * Hero section — pixel-matches Claude Design.
 *
 * Three states (running / fresh / blocked) — flowing editorial layout, NO
 * card wrapper. Big display headline (`text-5xl md:text-6xl`) with italic
 * accent on the most important number/concept.
 */
export async function AutoPilotHero({ setup: setupProp }: AutoPilotHeroProps) {
  const auth = await getCurrentAuth();
  const orgId = auth?.organization?.id ?? null;
  const [setup, stats, imapAccount, exportTargets] = await Promise.all([
    // orgId pflicht: ohne ihn prüft getSetupSnapshot globale secret_refs
    // und meldet fälschlich "nicht configured" → HeroBlocked-Banner trotz
    // vollständigem User-Setup. Hard-Gate im Layout nutzt orgId korrekt.
    setupProp ? Promise.resolve(setupProp) : getSetupSnapshot(orgId),
    getAutomationStats(orgId),
    getPrimaryMailAccount(),
    getExportTargets(orgId),
  ]);

  const daysActive = stats.daysActive;
  const status = getAutoPilotStatus();
  const enabled = appConfig.features.autoPilotEnabled;
  const mailScan = status.find((s) => s.job === "mailScan");
  const anyJobRunning = status.some((s) => s.running);

  const isBlocked = !setup.smtpConfigured || !setup.imapConfigured;
  // Ergebnis-zuerst-Reihenfolge: hasResults greift, sobald Rechnungen erfasst
  // sind (freigegeben/ready ODER schon versendet) — also direkt nach dem
  // Onboarding, bevor der Export-Cron etwas verschickt hat. Vorher fiel dieser
  // Moment fälschlich auf "warten auf erste Rechnung" (nur exportedLifetime).
  const hasResults = !isBlocked && (stats.capturedCount > 0 || stats.exportedLifetime > 0);
  // INFETCH-206: eingegangen + warten auf Freigabe, aber noch nichts erfasst/exportiert.
  const hasReviewWaiting = !isBlocked && !hasResults && stats.needsReview > 0;

  // Fetch display emails for the running-state paragraph
  const inboxEmail = imapAccount?.username ?? null;
  const recipientEmail = exportTargets.find((t) => t.enabled)?.recipientEmail ?? null;

  if (isBlocked) return <HeroBlocked setup={setup} />;

  if (hasResults) {
    return (
      <HeroRunning
        enabled={enabled}
        anyJobRunning={anyJobRunning}
        exportedToday={stats.exportedToday}
        exportedLifetime={stats.exportedLifetime}
        capturedCount={stats.capturedCount}
        needsReview={stats.needsReview}
        nextRunSec={mailScan?.nextRunSec ?? null}
        inboxEmail={inboxEmail}
        recipientEmail={recipientEmail}
        daysActive={daysActive}
      />
    );
  }

  if (hasReviewWaiting) return <HeroReviewWaiting needsReview={stats.needsReview} />;

  // Echt leer — der Scan hat (noch) nichts gefunden.
  const initialPulse: HeroFreshPulse = {
    mailScanRunning: mailScan?.running ?? false,
    nextRunSec: mailScan?.nextRunSec ?? null,
    exportedLifetime: stats.exportedLifetime,
    capturedCount: stats.capturedCount,
  };
  return <HeroFresh setup={setup} initialPulse={initialPulse} />;
}

function HeroRunning({
  enabled,
  anyJobRunning,
  exportedToday,
  exportedLifetime,
  capturedCount,
  needsReview,
  nextRunSec,
  inboxEmail,
  recipientEmail,
  daysActive,
}: {
  enabled: boolean;
  anyJobRunning: boolean;
  exportedToday: number;
  exportedLifetime: number;
  capturedCount: number;
  needsReview: number;
  nextRunSec: number | null;
  inboxEmail: string | null;
  recipientEmail: string | null;
  daysActive: number | null;
}) {
  // In-Flight: erfasst, aber noch nichts versendet (direkt nach Onboarding-Freigabe).
  const inFlight = exportedLifetime === 0 && capturedCount > 0;
  const statusLabel = enabled
    ? anyJobRunning
      ? "Auto-Pilot · arbeitet gerade"
      : daysActive !== null && daysActive > 0
        ? `Auto-Pilot · läuft seit ${daysActive} ${daysActive === 1 ? "Tag" : "Tagen"}`
        : "Auto-Pilot · aktiv"
    : "Auto-Pilot · pausiert";

  return (
    <div className="py-2">
      <div className="inline-flex items-center gap-2 text-xs text-ok">
        <span className="h-1.5 w-1.5 rounded-full bg-ok ap-pulse" aria-hidden />
        {statusLabel}
      </div>

      <h2 className="mt-4 max-w-3xl font-display text-3xl leading-[1.05] text-ink sm:text-5xl md:text-6xl">
        {inFlight ? (
          <>
            {capturedCount === 1 ? "1 Rechnung" : `${capturedCount} Rechnungen`} geholt —{" "}
            <em>unterwegs zur Buchhaltung.</em>
          </>
        ) : (
          <>
            Heute{" "}
            <em>{exportedToday > 0 ? `${exportedToday} versendet.` : "noch nichts versendet."}</em>
          </>
        )}
        {needsReview > 0 && (
          <span className="mt-1 block text-ink">
            {needsReview === 1 ? "1 wartet auf dein OK." : `${needsReview} warten auf dein OK.`}
          </span>
        )}
      </h2>

      {(inboxEmail || recipientEmail) && (
        <p className="mt-3 max-w-xl text-muted md:mt-6">
          {inboxEmail && (
            <>Wir scannen <span className="text-ink">{inboxEmail}</span> automatisch. </>
          )}
          {recipientEmail && (
            <>Sichere Treffer gehen direkt an <span className="text-ink">{recipientEmail}</span>. </>
          )}
          Unsichere fragen wir hier.
        </p>
      )}

      <div className="mt-6 flex flex-wrap items-center gap-3">
        {needsReview > 0 && (
          <Link
            href="/audit?tab=review"
            className="hidden md:inline-flex h-10 items-center gap-2 rounded bg-brand px-4 text-sm font-medium text-white shadow-soft transition-all hover:shadow-pop"
          >
            {needsReview === 1 ? "1 prüfen" : `${needsReview} prüfen`}
            <ArrowRight className="h-4 w-4" aria-hidden />
          </Link>
        )}
        <ScanButton />
        {enabled && nextRunSec !== null && (
          <span className="hidden md:inline text-xs text-muted stat-num">
            nächster Scan in {formatCountdown(nextRunSec)}
          </span>
        )}
      </div>
    </div>
  );
}

// INFETCH-206: Rechnungen eingegangen, warten auf Freigabe, noch nichts exportiert.
function HeroReviewWaiting({ needsReview }: { needsReview: number }) {
  return (
    <div className="py-2">
      <div className="inline-flex items-center gap-2 text-xs text-ok">
        <span className="h-1.5 w-1.5 rounded-full bg-ok ap-pulse" aria-hidden />
        Auto-Pilot · Rechnungen eingegangen
      </div>
      <h2 className="mt-4 max-w-3xl font-display text-3xl leading-[1.05] text-ink sm:text-5xl md:text-6xl">
        {needsReview === 1 ? "1 Rechnung wartet" : `${needsReview} Rechnungen warten`}{" "}
        <em>auf dein OK.</em>
      </h2>
      <p className="mt-3 max-w-xl text-muted md:mt-6">
        Wir haben sie aus deinem Postfach geholt und vorbereitet. Prüf sie einmal kurz —
        danach übernimmt der Auto-Pilot Versand und Ablage automatisch.
      </p>
      <div className="mt-6 flex flex-wrap items-center gap-3">
        <Link
          href="/audit?tab=review"
          className="inline-flex h-10 items-center gap-2 rounded bg-brand px-4 text-sm font-medium text-white shadow-soft transition-all hover:shadow-pop"
        >
          {needsReview === 1 ? "1 prüfen" : `${needsReview} prüfen`}
          <ArrowRight className="h-4 w-4" aria-hidden />
        </Link>
      </div>
    </div>
  );
}

function HeroBlocked({ setup }: { setup: Setup }) {
  const missing: string[] = [];
  if (!setup.imapConfigured) missing.push("Postfach");
  if (!setup.smtpConfigured) missing.push("Versand-Adresse");

  return (
    <div className="py-2">
      <div className="text-xs text-warn">1 Sache braucht deine Aufmerksamkeit</div>
      <h2 className="mt-3 max-w-3xl font-display text-3xl leading-[0.95] text-ink sm:text-5xl md:text-6xl">
        <em>Einrichtung</em> nicht<br />
        abgeschlossen.
      </h2>
      <p className="mt-5 max-w-xl text-muted">
        Es fehlt noch: <span className="text-ink">{missing.join(" und ")}</span>. Danach läuft alles automatisch — du musst hier nichts mehr tun.
      </p>
      <div className="mt-6 flex flex-wrap items-center gap-3">
        <Link
          href="/einstellungen"
          className="inline-flex h-10 items-center gap-2 rounded bg-brand px-4 text-sm font-medium text-white shadow-soft transition-all hover:shadow-pop"
        >
          jetzt einrichten <ArrowRight className="h-4 w-4" aria-hidden />
        </Link>
        <button
          type="button"
          className="inline-flex h-10 items-center gap-2 rounded px-3 text-sm text-muted transition-colors hover:bg-line/50 hover:text-ink"
        >
          später · Erinnerung in 3 Tagen
        </button>
      </div>
    </div>
  );
}

function HeroFresh({
  setup,
  initialPulse,
}: {
  setup: Setup;
  initialPulse: HeroFreshPulse;
}) {
  return (
    <div className="grid items-start gap-12 py-2 md:grid-cols-2">
      <div>
        <div className="text-xs text-muted">bereit</div>
        <h2 className="mt-3 font-display text-3xl leading-[0.95] text-ink sm:text-5xl md:text-6xl">
          Wir warten auf deine <em>erste Rechnung.</em>
        </h2>
        <p className="mt-5 max-w-md text-muted">
          Infetch scannt dein Postfach automatisch im Hintergrund. Sobald eine Rechnung ankommt, übernehmen wir den Rest.
        </p>
        {setup.imapConfigured && (
          <div className="mt-5 space-y-3">
            <HeroFreshLive initial={initialPulse} />
            <ScanButton />
          </div>
        )}
      </div>
      <FreshChecklist setup={setup} />
    </div>
  );
}

function FreshChecklist({ setup }: { setup: Setup }) {
  const steps = [
    { done: true,               label: "Account erstellt",        active: false, href: null },
    { done: setup.imapConfigured, label: "Postfach verbunden",    active: !setup.imapConfigured, href: "/einstellungen?tab=postfach" },
    { done: setup.exportTargetActive, label: "Empfänger eingerichtet", active: !setup.exportTargetActive && setup.imapConfigured, href: "/einstellungen?tab=buchhaltung" },
    { done: false,              label: "Erste Rechnung empfangen", active: false, href: null },
  ];
  return (
    <ol className="border-t border-line">
      {steps.map((s, i) => (
        <li key={s.label} className="flex items-center gap-3 border-b border-line py-4">
          <div
            className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-xs ${
              s.done ? "text-ok" : s.active ? "text-ink" : "text-muted"
            }`}
          >
            {s.done ? <Check size={14} aria-hidden /> : i + 1}
          </div>
          <div className={`text-sm ${s.done ? "text-muted" : "text-ink"}`}>{s.label}</div>
          {s.active && s.href && (
            <Link
              href={s.href}
              className="ml-auto text-xs text-ink underline decoration-line underline-offset-4 hover:decoration-ink"
            >
              öffnen
            </Link>
          )}
        </li>
      ))}
    </ol>
  );
}
