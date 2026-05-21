"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import Image from "next/image";
import Link from "next/link";
import { Loader2, Search, WifiOff } from "lucide-react";
import type { DiscoveredSender } from "@/senders/discovered-senders";
import { blockSenderAction, unblockSenderAction } from "@/app/(app)/senders/actions";
import { finishOnboardingTriageAction } from "@/app/(app)/audit/actions";
import {
  getOnboardingScanStatusAction,
  getDiscoveredSendersAction,
  type OnboardingScanStatus,
} from "@/app/onboarding/actions";
import { VendorLogo } from "@/components/ui/vendor-logo";

interface SenderItem {
  id: number;
  domain: string;
  name: string;
  hint: string;
  count: number;
  kind: "business" | "private";
  unsure: boolean;
  originallyBlocked: boolean;
}

function buildItems(senders: DiscoveredSender[]): SenderItem[] {
  return senders.map((s) => {
    const name = s.displayName || s.fromAddress;
    const privateHints = [
      "spotify.com", "netflix.com", "amazon.de", "amazon.com", "rewe.de",
      "lidl.de", "aldi.de", "dhl.de", "dpd.de", "hermes.de",
      "vodafone.de", "o2.de", "klarna.de", "ikea.de", "stadtwerke",
    ];
    const looksPrivate = privateHints.some((h) => s.fromDomain.includes(h));
    const unsure = [
      "amazon.de", "amazon.com", "telekom.de", "vodafone.de", "dhl.de",
    ].some((h) => s.fromDomain.includes(h));

    return {
      id: s.id,
      domain: s.fromDomain,
      name,
      hint: s.matchedVendorName ? s.matchedVendorName : s.fromDomain.split(".")[0],
      count: s.mailCount,
      kind: s.blocked || looksPrivate ? "private" : "business",
      unsure,
      originallyBlocked: s.blocked,
    };
  });
}

export function ErstabrufClient({ senders }: { senders: DiscoveredSender[] }) {
  const router = useRouter();
  const [phase, setPhase] = useState<"scan" | "result" | "review" | "error">(
    senders.length === 0 ? "scan" : "review",
  );
  const [scanError, setScanError] = useState<string | null>(null);
  const [scan, setScan] = useState<OnboardingScanStatus | null>(null);
  const [filter, setFilter] = useState<"all" | "unsure" | "private">("all");
  const [q, setQ] = useState("");
  const [saving, setSaving] = useState(false);
  const [items, setItems] = useState<SenderItem[]>(() => buildItems(senders));

  // Real first scan: poll until it finishes (we wait — no skipping).
  // sync_runs ist org-scoped (Migration 0030) — getOnboardingScanStatusAction
  // liefert direkt die letzte imap_scan-Row dieser Org. Kein Zeitfenster-Puffer
  // mehr nötig (früher `pollSinceIso`, um fremde/alte Runs auszublenden).
  useEffect(() => {
    if (phase !== "scan") return;
    let cancelled = false;
    const startedAt = Date.now();

    const poll = async () => {
      let status: OnboardingScanStatus;
      try {
        status = await getOnboardingScanStatusAction();
      } catch {
        if (!cancelled) setTimeout(poll, 2500);
        return;
      }
      if (cancelled) return;
      setScan(status);

      if (status.state === "succeeded") {
        try {
          const fresh = await getDiscoveredSendersAction();
          if (!cancelled) setItems(buildItems(fresh));
        } catch {
          /* keep whatever senders we already have */
        }
        if (!cancelled) setPhase("result");
        return;
      }
      if (status.state === "failed") {
        if (!cancelled) {
          setScanError(status.error ?? "Der erste Abruf ist fehlgeschlagen.");
          setPhase("error");
        }
        return;
      }
      // "none" (run row not created yet) or "running" → keep waiting.
      // If no run ever appears within 45s, the scan didn't start.
      if (status.state === "none" && Date.now() - startedAt > 45_000) {
        if (!cancelled) {
          setScanError("Der erste Abruf konnte nicht gestartet werden. Du kannst ihn in den Einstellungen erneut auslösen.");
          setPhase("error");
        }
        return;
      }
      setTimeout(poll, 2500);
    };

    poll();
    return () => {
      cancelled = true;
    };
  }, [phase]);

  const stats = useMemo(
    () => ({
      total: items.length,
      business: items.filter((x) => x.kind === "business").length,
      privat: items.filter((x) => x.kind === "private").length,
      unsure: items.filter((x) => x.unsure).length,
    }),
    [items],
  );

  const visible = useMemo(() => {
    return items.filter((x) => {
      if (filter === "unsure" && !x.unsure) return false;
      if (filter === "private" && x.kind !== "private") return false;
      if (q) {
        const lq = q.toLowerCase();
        if (!x.name.toLowerCase().includes(lq) && !x.domain.includes(lq)) return false;
      }
      return true;
    });
  }, [items, filter, q]);

  const setKind = (id: number, kind: "business" | "private") => {
    setItems((arr) => arr.map((x) => (x.id === id ? { ...x, kind, unsure: false } : x)));
  };

  const finish = async () => {
    setSaving(true);
    try {
      const promises: Promise<unknown>[] = [];
      // 1) Absender-Block-Status setzen (privat → blocken, zurück → entsperren).
      for (const item of items) {
        const wantsBlocked = item.kind === "private";
        if (wantsBlocked && !item.originallyBlocked) {
          const fd = new FormData();
          fd.set("senderId", String(item.id));
          fd.set("reason", "Privat (Erstabruf)");
          promises.push(blockSenderAction({ status: "idle", message: "" }, fd));
        } else if (!wantsBlocked && item.originallyBlocked) {
          const fd = new FormData();
          fd.set("senderId", String(item.id));
          promises.push(unblockSenderAction({ status: "idle", message: "" }, fd));
        }
      }
      // 2) Rechnungen im SELBEN Schritt freigeben/ignorieren — server-seitig auf
      //    den LIVE needs_review-Rechnungen (NICHT auf einem Seitenaufbau-Snapshot;
      //    der Scan importiert asynchron, sonst blieben spät importierte Rechnungen
      //    in needs_review hängen). Privat-Absender → ignorieren, Rest → freigeben.
      const privateDomains = items
        .filter((i) => i.kind === "private")
        .map((i) => i.domain);
      promises.push(finishOnboardingTriageAction(privateDomains));
      await Promise.all(promises);
    } finally {
      setSaving(false);
    }
    router.push("/");
  };

  // ══ Scan phase — real progress, live counters ════════════════════════════════
  if (phase === "scan") {
    return (
      <div className="flex min-h-screen flex-col bg-paper">
        <header className="flex h-14 items-center border-b border-line px-6">
          <Image src="/images/brand/infetch-logo.svg" alt="Infetch" width={90} height={28} className="h-7 w-auto" priority />
        </header>
        <main className="flex flex-1 items-center">
          <div className="mx-auto w-full max-w-xl px-6">
            <div className="text-xs uppercase tracking-[0.14em] text-muted">Erstabruf</div>
            <h1 className="mt-3 font-display text-4xl leading-[1.05] text-ink md:text-5xl">
              Wir durchsuchen<br />dein Postfach.
            </h1>
            <p className="mt-5 leading-relaxed text-muted">
              Das kann je nach Postfachgröße ein paar Minuten dauern — bitte
              lass das Fenster offen. Wir lesen nur Mails mit Rechnungsmerkmalen.
            </p>

            <div className="mt-12 flex items-center gap-3 text-sm text-ink">
              <Loader2 size={18} className="animate-spin shrink-0 text-muted" aria-hidden />
              <span>Postfach wird durchsucht…</span>
            </div>

            <dl className="mt-8 grid grid-cols-3 gap-x-8 gap-y-2 border-y border-line py-5">
              <div>
                <dt className="text-xs text-muted">Mails durchsucht</dt>
                <dd className="stat-num font-display text-2xl text-ink">{scan?.messagesSeen ?? 0}</dd>
              </div>
              <div>
                <dt className="text-xs text-muted">PDFs gefunden</dt>
                <dd className="stat-num font-display text-2xl text-ink">{scan?.pdfsFound ?? 0}</dd>
              </div>
              <div>
                <dt className="text-xs text-muted">Rechnungen</dt>
                <dd className="stat-num font-display text-2xl text-ink">{scan?.imported ?? 0}</dd>
              </div>
            </dl>
          </div>
        </main>
      </div>
    );
  }

  // ══ Result phase — the payoff ════════════════════════════════════════════════
  if (phase === "result") {
    const imported = scan?.imported ?? 0;
    return (
      <div className="flex min-h-screen flex-col bg-paper">
        <header className="flex h-14 items-center border-b border-line px-6">
          <Image src="/images/brand/infetch-logo.svg" alt="Infetch" width={90} height={28} className="h-7 w-auto" priority />
        </header>
        <main className="flex flex-1 items-center">
          <div className="mx-auto w-full max-w-xl px-6">
            <div className="text-xs uppercase tracking-[0.14em] text-muted">Erstabruf abgeschlossen</div>
            {imported > 0 ? (
              <>
                <h1 className="mt-3 font-display text-5xl leading-[1.05] text-ink md:text-6xl">
                  <span className="stat-num">{imported}</span>{" "}
                  {imported === 1 ? "Rechnung" : "Rechnungen"} geholt.
                </h1>
                <p className="mt-5 leading-relaxed text-muted">
                  Bereits in Infetch. Ab jetzt läuft der Scan automatisch
                  im Hintergrund weiter.
                </p>
              </>
            ) : (
              <>
                <h1 className="mt-3 font-display text-4xl leading-[1.05] text-ink md:text-5xl">
                  Postfach durchsucht.
                </h1>
                <p className="mt-5 leading-relaxed text-muted">
                  Aktuell keine Rechnungen gefunden. Infetch scannt dein
                  Postfach ab jetzt automatisch im Hintergrund weiter.
                </p>
              </>
            )}

            <dl className="mt-10 grid grid-cols-3 gap-x-8 gap-y-2 border-y border-line py-5">
              <div>
                <dt className="text-xs text-muted">Mails durchsucht</dt>
                <dd className="stat-num font-display text-2xl text-ink">{scan?.messagesSeen ?? 0}</dd>
              </div>
              <div>
                <dt className="text-xs text-muted">PDFs gefunden</dt>
                <dd className="stat-num font-display text-2xl text-ink">{scan?.pdfsFound ?? 0}</dd>
              </div>
              <div>
                <dt className="text-xs text-muted">Duplikate</dt>
                <dd className="stat-num font-display text-2xl text-ink">{scan?.duplicates ?? 0}</dd>
              </div>
            </dl>

            <button
              onClick={() => (items.length > 0 ? setPhase("review") : router.push("/"))}
              className="mt-10 h-11 rounded bg-ink px-6 text-sm text-white hover:opacity-90"
            >
              {items.length > 0 ? "Weiter — Absender sortieren →" : "Zur App →"}
            </button>
          </div>
        </main>
      </div>
    );
  }

  // ══ Error phase ══════════════════════════════════════════════════════════════
  if (phase === "error") {
    return (
      <div className="flex min-h-screen flex-col bg-paper">
        <header className="flex h-14 items-center border-b border-line px-6">
          <Image src="/images/brand/infetch-logo.svg" alt="Infetch" width={90} height={28} className="h-7 w-auto" priority />
        </header>
        <main className="flex flex-1 items-center justify-center px-6">
          <div className="w-full max-w-md text-center">
            <WifiOff size={36} className="mx-auto text-danger" aria-hidden />
            <h1 className="mt-4 text-xl font-semibold text-ink">Erster Abruf fehlgeschlagen</h1>
            <p className="mt-2 text-sm text-muted">
              Das Postfach konnte nicht vollständig durchsucht werden.
            </p>
            {scanError && (
              <p className="mt-2 rounded-md border border-danger/20 bg-danger/5 px-3 py-2 text-xs text-danger">
                {scanError}
              </p>
            )}
            <div className="mt-6 flex flex-col gap-2">
              <Link
                href="/onboarding"
                className="inline-flex h-10 items-center justify-center rounded bg-brand px-4 text-sm font-medium text-white hover:opacity-90"
              >
                Postfach neu einrichten
              </Link>
              <Link href="/" className="text-xs text-muted hover:text-ink">
                Zur App — ich kümmere mich später darum
              </Link>
            </div>
          </div>
        </main>
      </div>
    );
  }

  // ══ Review phase — private/business triage ═══════════════════════════════════
  return (
    <div className="min-h-screen bg-paper">
      <header className="flex h-14 items-center justify-between border-b border-line px-6">
        <Image
          src="/images/brand/infetch-logo.svg"
          alt="Infetch"
          width={90}
          height={28}
          className="h-7 w-auto"
          priority
        />
        <button
          onClick={finish}
          disabled={saving}
          className="text-xs text-muted underline decoration-line underline-offset-4 hover:text-ink disabled:opacity-50"
        >
          überspringen
        </button>
      </header>

      <div className="mx-auto max-w-[920px] px-6 py-12 md:py-16">
        <div className="text-xs uppercase tracking-[0.14em] text-muted">
          Erstabruf · Anbieter sortieren
        </div>
        <h1 className="mt-3 font-display text-4xl leading-[1.05] text-ink md:text-5xl">
          <span className="stat-num">{stats.total}</span> Anbieter gefunden.
          <br />
          Was ist <em className="italic text-muted">privat</em>?
        </h1>
        <p className="mt-5 max-w-xl leading-relaxed text-muted">
          Du wählst pro <strong className="font-medium text-ink">Anbieter</strong> —
          nicht pro einzelner Rechnung. Privates geht nie an deine Buchhaltung,
          alles später änderbar.
        </p>

        <dl className="mt-10 grid grid-cols-3 gap-x-8 gap-y-2 border-y border-line py-5">
          <div>
            <dt className="text-xs text-muted">geschäftlich</dt>
            <dd className="stat-num font-display text-2xl text-ink">{stats.business}</dd>
          </div>
          <div>
            <dt className="text-xs text-muted">privat</dt>
            <dd className="stat-num font-display text-2xl text-ink">{stats.privat}</dd>
          </div>
          <div>
            <dt className="text-xs text-muted">unsicher</dt>
            <dd className="stat-num font-display text-2xl text-ink">{stats.unsure}</dd>
          </div>
        </dl>

        <div className="mt-8 flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
          <div className="flex items-center gap-1 text-xs">
            {(
              [
                { id: "all" as const,     label: `Alle · ${items.length}` },
                { id: "unsure" as const,  label: `Unsicher · ${stats.unsure}` },
                { id: "private" as const, label: `Privat · ${stats.privat}` },
              ] as const
            ).map((o) => (
              <button
                key={o.id}
                onClick={() => setFilter(o.id)}
                className={`h-7 rounded px-2.5 ${
                  filter === o.id
                    ? "bg-ink text-white"
                    : "text-muted hover:text-ink"
                }`}
              >
                {o.label}
              </button>
            ))}
          </div>
          <div className="relative w-full md:w-64">
            <Search
              size={14}
              className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted"
            />
            <input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Anbieter suchen…"
              className="h-9 w-full rounded border border-line bg-white pl-9 pr-3 text-sm placeholder:text-muted/70 outline-none focus:border-brand focus:ring-2 focus:ring-brand/20"
            />
          </div>
        </div>

        <ul className="mt-2">
          {visible.map((a) => (
            <li key={a.id} className="flex items-center gap-4 border-b border-line py-4">
              <VendorLogo domain={a.domain} name={a.name} size={36} />
              <div className="min-w-0 flex-1">
                <div className="flex items-baseline gap-3">
                  <div className="truncate text-sm font-medium text-ink">{a.name}</div>
                  {a.unsure && (
                    <span className="text-[10px] uppercase tracking-[0.1em] text-warn">
                      unsicher
                    </span>
                  )}
                </div>
                <div className="mt-1 text-xs text-muted">
                  <span className="stat-num">{a.count}</span> Mails ·{" "}
                  <span className="text-muted/70">{a.hint}</span>
                </div>
              </div>
              <div className="flex shrink-0 items-center rounded border border-line bg-white text-xs">
                <button
                  onClick={() => setKind(a.id, "business")}
                  className={`h-8 rounded-l px-3 ${
                    a.kind === "business"
                      ? "bg-ink text-white"
                      : "text-muted hover:text-ink"
                  }`}
                >
                  Geschäftlich
                </button>
                <button
                  onClick={() => setKind(a.id, "private")}
                  className={`h-8 rounded-r border-l border-line px-3 ${
                    a.kind === "private"
                      ? "bg-ink text-white"
                      : "text-muted hover:text-ink"
                  }`}
                >
                  Privat
                </button>
              </div>
            </li>
          ))}
          {visible.length === 0 && (
            <li className="py-12 text-center text-sm text-muted">
              {items.length === 0
                ? "Keine Anbieter zum Sortieren — Infetch scannt ab jetzt automatisch weiter."
                : `Nichts gefunden${q ? ` zu „${q}"` : ""}.`}
            </li>
          )}
        </ul>

        <div className="mt-12 flex flex-col gap-4 border-t border-line pt-8 md:flex-row md:items-center md:justify-between">
          <div className="max-w-md text-xs text-muted">
            <span className="text-ink">{stats.business}</span> Anbieter werden
            an deine Buchhaltung weitergeleitet.{" "}
            <span className="text-ink">{stats.privat}</span> bleiben in deinem
            Postfach — Infetch fasst sie nicht an.
          </div>
          <button
            onClick={finish}
            disabled={saving}
            className="h-11 shrink-0 rounded bg-ink px-6 text-sm text-white hover:opacity-90 disabled:opacity-50"
          >
            {saving ? "Wird gespeichert…" : "Übernehmen & loslegen →"}
          </button>
        </div>
      </div>
    </div>
  );
}
