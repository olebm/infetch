"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { RefreshCw } from "lucide-react";
import { runImapScanAction, type CredentialFormState } from "@/app/(app)/einstellungen/actions";

// ─── Konstanten ────────────────────────────────────────────────────────────────
const THRESHOLD = 64; // px Zugdistanz bis Auslösen
const DAMPING = 0.45; // Dämpfung: 1:1-Zug fühlt sich zu schwer an
const IDLE: CredentialFormState = { status: "idle", message: "" };

// ─── Komponente ────────────────────────────────────────────────────────────────

/**
 * Pull-to-Refresh für den Posteingang.
 * Nur auf Touch-Geräten aktiv. Platzierung: zwischen PageHeader und Tab-Bar,
 * damit der Inhalt beim Ziehen nach unten gedrückt wird.
 *
 * - Threshold: 64 px gedämpfte Zugdistanz
 * - Visuell: drehendes RefreshCw-Icon, Opacity + Rotation proportional zum Zug
 * - Auslösen: Server-Action + router.refresh() innerhalb startTransition
 */
export function PullToRefresh() {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [pullY, setPullY] = useState(0);

  const startYRef = useRef(0);
  const activeRef = useRef(false);
  const firedRef = useRef(false);

  useEffect(() => {
    function onStart(e: TouchEvent) {
      if (window.scrollY > 4) return; // nur am Seitenanfang
      activeRef.current = true;
      firedRef.current = false;
      startYRef.current = e.touches[0].clientY;
    }

    function onMove(e: TouchEvent) {
      if (!activeRef.current) return;
      const delta = e.touches[0].clientY - startYRef.current;
      setPullY(delta > 0 ? Math.min(delta * DAMPING, THRESHOLD + 20) : 0);
    }

    function onEnd() {
      if (!activeRef.current) return;
      activeRef.current = false;

      // State-Setter-Callback: liest aktuellen Wert ohne Dependency
      setPullY((y) => {
        if (y >= THRESHOLD && !firedRef.current) {
          firedRef.current = true;
          startTransition(async () => {
            await runImapScanAction(IDLE);
            router.refresh();
          });
        }
        return 0; // snap zurück
      });
    }

    window.addEventListener("touchstart", onStart, { passive: true });
    window.addEventListener("touchmove", onMove, { passive: true });
    window.addEventListener("touchend", onEnd);
    window.addEventListener("touchcancel", onEnd);

    return () => {
      window.removeEventListener("touchstart", onStart);
      window.removeEventListener("touchmove", onMove);
      window.removeEventListener("touchend", onEnd);
      window.removeEventListener("touchcancel", onEnd);
    };
  }, [router, startTransition]);

  const progress = Math.min(pullY / THRESHOLD, 1);
  const ready = progress >= 1;

  // Unsichtbar solange kein Zug und kein laufender Fetch
  if (pullY === 0 && !isPending) return null;

  return (
    <div
      // Höhe animiert: beim Ziehen = pullY, beim Laden = 44px fest, danach = 0
      className="flex items-center justify-center gap-2 overflow-hidden text-xs transition-[height] duration-200"
      style={{ height: isPending ? 44 : pullY }}
      aria-live="polite"
      aria-label={isPending ? "Wird geholt…" : ready ? "Loslassen zum Aktualisieren" : undefined}
    >
      <RefreshCw
        size={14}
        className={isPending ? "animate-spin text-brand" : ready ? "text-brand" : "text-muted"}
        style={
          isPending ? undefined : { transform: `rotate(${progress * 360}deg)`, opacity: progress }
        }
        aria-hidden
      />
      <span
        className="transition-opacity duration-150"
        style={{ opacity: isPending ? 1 : Math.max(0, progress * 2 - 1) }}
      >
        {isPending ? "Wird geholt…" : "Loslassen"}
      </span>
    </div>
  );
}
