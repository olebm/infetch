"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import {
  getHeroFreshPulseAction,
  type HeroFreshPulse,
} from "@/lib/actions/scan-pulse";

// Client-Island im HeroFresh: zeigt "scannt jetzt"-Puls oder
// "naechster Scan in X" und pollt alle 5 Sek. Sobald exportedLifetime > 0
// wird, refreshen wir die Server-Komponente — AutoPilotHero rendert dann
// HeroRunning statt HeroFresh (Switch passiert dadurch automatisch).
export function HeroFreshLive({ initial }: { initial: HeroFreshPulse }) {
  const router = useRouter();
  const [pulse, setPulse] = useState<HeroFreshPulse>(initial);

  useEffect(() => {
    let cancelled = false;
    const POLL_MS = 5_000;

    const tick = async () => {
      try {
        const next = await getHeroFreshPulseAction();
        if (cancelled) return;
        setPulse(next);
        if (next.exportedLifetime > 0 || next.capturedCount > 0) {
          // Rechnung erfasst (freigegeben/ready) ODER schon versendet →
          // Server-Render neu anstossen, damit HeroFresh durch den
          // Erfolgs-Hero ersetzt wird. Kein full reload.
          router.refresh();
          return;
        }
      } catch {
        // Polling-Fehler still ignorieren — naechster Tick versucht's neu.
      }
      if (!cancelled) setTimeout(tick, POLL_MS);
    };

    const t = setTimeout(tick, POLL_MS);
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
  }, [router]);

  if (pulse.mailScanRunning) {
    return (
      <div className="inline-flex items-center gap-2 text-xs text-ok">
        <span className="h-1.5 w-1.5 rounded-full bg-ok ap-pulse" aria-hidden />
        Postfach wird gerade gescannt …
      </div>
    );
  }
  if (pulse.nextRunSec !== null) {
    return (
      <div className="text-xs text-muted">
        Abruf läuft stündlich automatisch
      </div>
    );
  }
  return null;
}
