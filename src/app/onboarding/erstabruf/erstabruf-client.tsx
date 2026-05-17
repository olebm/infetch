"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import Image from "next/image";
import { Check, Loader2, Search, WifiOff } from "lucide-react";
import type { DiscoveredSender } from "@/senders/discovered-senders";
import { blockSenderAction, unblockSenderAction } from "@/app/(app)/senders/actions";
import { verifyOnboardingConnectionAction } from "@/app/onboarding/actions";
import { VendorLogo } from "@/components/ui/vendor-logo";

const SCAN_STEPS = [
  "Postfach verbunden",
  "Letzte 12 Monate werden durchsucht",
  "Anhänge analysiert",
  "Anbieter erkannt",
];

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

export function ErstabrufClient({ senders }: { senders: DiscoveredSender[] }) {
  const router = useRouter();
  const [phase, setPhase] = useState<"verifying" | "scan" | "review" | "error">(
    senders.length === 0 ? "verifying" : "review",
  );
  const [verifyError, setVerifyError] = useState<string | null>(null);
  const [scanPct, setScanPct] = useState(0);
  const [scanStep, setScanStep] = useState(0);
  const [filter, setFilter] = useState<"all" | "unsure" | "private">("all");
  const [q, setQ] = useState("");
  const [saving, setSaving] = useState(false);

  // Initialize items from real DB senders
  const [items, setItems] = useState<SenderItem[]>(() =>
    senders.map((s) => {
      const name = s.displayName || s.fromAddress;
      // Heuristic: known private domains
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
        hint: s.matchedVendorName
          ? s.matchedVendorName
          : s.fromDomain.split(".")[0],
        count: s.mailCount,
        kind: s.blocked || looksPrivate ? "private" : "business",
        unsure,
        originallyBlocked: s.blocked,
      };
    }),
  );

  // Real IMAP verification — first thing we do before showing the scan animation
  useEffect(() => {
    if (phase !== "verifying") return;
    verifyOnboardingConnectionAction().then((result) => {
      if (result.ok) {
        // Start scan animation with first step already done
        setScanPct(27);
        setScanStep(1);
        setPhase("scan");
      } else {
        setVerifyError(result.error ?? "Verbindung fehlgeschlagen.");
        setPhase("error");
      }
    });
  }, [phase]);

  // Scan animation — runs once we're in scan phase (first step pre-verified)
  useEffect(() => {
    if (phase !== "scan") return;
    const tick = setInterval(() => {
      setScanPct((prev) => {
        const next = Math.min(100, prev + 2 + Math.random() * 3);
        setScanStep(Math.min(SCAN_STEPS.length - 1, Math.floor(next / 26)));
        if (next >= 100) {
          clearInterval(tick);
          setTimeout(() => setPhase("review"), 450);
        }
        return next;
      });
    }, 70);
    return () => clearInterval(tick);
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
      // Apply block/unblock for items whose state differs from original
      const promises: Promise<unknown>[] = [];
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
      await Promise.all(promises);
    } finally {
      setSaving(false);
    }
    router.push("/");
  };

  // ══ Verifying phase ═════════════════════════════════════════════════════════
  if (phase === "verifying") {
    return (
      <div className="flex min-h-screen flex-col bg-paper">
        <header className="flex h-14 items-center border-b border-line px-6">
          <Image src="/images/brand/infetch-logo.svg" alt="Infetch" width={90} height={28} className="h-7 w-auto" priority />
        </header>
        <main className="flex flex-1 items-center justify-center">
          <div className="flex flex-col items-center gap-4 text-center">
            <Loader2 size={32} className="animate-spin text-muted" aria-hidden />
            <p className="text-sm text-muted">Postfach wird verbunden…</p>
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
            <h1 className="mt-4 text-xl font-semibold text-ink">Verbindung fehlgeschlagen</h1>
            <p className="mt-2 text-sm text-muted">
              Das Postfach konnte nicht erreicht werden — möglicherweise hat sich das Passwort geändert.
            </p>
            {verifyError && (
              <p className="mt-2 rounded-md border border-danger/20 bg-danger/5 px-3 py-2 text-xs text-danger">
                {verifyError}
              </p>
            )}
            <div className="mt-6 flex flex-col gap-2">
              <a
                href="/onboarding"
                className="inline-flex h-10 items-center justify-center rounded bg-brand px-4 text-sm font-medium text-white hover:opacity-90"
              >
                Postfach neu einrichten
              </a>
              <a href="/" className="text-xs text-muted hover:text-ink">
                Zur App — ich kümmere mich später darum
              </a>
            </div>
          </div>
        </main>
      </div>
    );
  }

  // ══ Scan phase ══════════════════════════════════════════════════════════════
  if (phase === "scan") {
    return (
      <div className="flex min-h-screen flex-col bg-paper">
        <header className="flex h-14 items-center border-b border-line px-6">
          <Image
            src="/images/brand/infetch-logo.svg"
            alt="Infetch"
            width={90}
            height={28}
            className="h-7 w-auto"
            priority
          />
        </header>
        <main className="flex flex-1 items-center">
          <div className="mx-auto w-full max-w-xl px-6">
            <div className="text-xs uppercase tracking-[0.14em] text-muted">
              Erstabruf
            </div>
            <h1 className="mt-3 font-display text-4xl leading-[1.05] text-ink md:text-5xl">
              Wir hören uns dein<br />
              Postfach einmal an.
            </h1>
            <p className="mt-5 leading-relaxed text-muted">
              Damit du gleich entscheiden kannst, was geschäftlich ist und was
              privat bleibt. Wir lesen nur Mails mit Rechnungsmerkmalen.
            </p>

            <div className="mt-12">
              <div className="flex items-baseline justify-between">
                <div className="text-sm text-ink">{SCAN_STEPS[scanStep]}…</div>
                <div className="stat-num text-xs text-muted">
                  {Math.floor(scanPct)}&nbsp;%
                </div>
              </div>
              <div className="relative mt-3 h-px overflow-hidden bg-line">
                <div
                  className="absolute inset-y-0 left-0 bg-ink transition-all duration-300"
                  style={{ width: scanPct + "%" }}
                />
              </div>
              <ul className="mt-6 space-y-2 text-xs text-muted">
                {SCAN_STEPS.map((s, i) => (
                  <li key={s} className="flex items-center gap-2">
                    <span
                      className={`inline-block h-3 w-3 rounded-full border ${
                        i < scanStep
                          ? "border-ink bg-ink"
                          : i === scanStep
                            ? "border-ink"
                            : "border-line"
                      }`}
                    />
                    <span className={i <= scanStep ? "text-ink" : ""}>{s}</span>
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </main>
      </div>
    );
  }

  // ══ Review phase ═══════════════════════════════════════════════════════════
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
          Erstabruf · Schritt 2 von 2
        </div>
        <h1 className="mt-3 font-display text-4xl leading-[1.05] text-ink md:text-5xl">
          <span className="stat-num">{stats.total}</span> Anbieter gefunden.
          <br />
          Was ist <em className="italic text-muted">privat</em>?
        </h1>
        <p className="mt-5 max-w-xl leading-relaxed text-muted">
          Was du jetzt als privat markierst, wird nie an deine Buchhaltung
          weitergeleitet — auch nicht in zwei Jahren. Du kannst alles später
          ändern.
        </p>

        {/* Stats */}
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

        {/* Filter + search */}
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

        {/* List */}
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
              {/* Segmented toggle */}
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
                ? "Noch keine Anbieter entdeckt — starte den ersten Scan über die Einstellungen."
                : `Nichts gefunden${q ? ` zu „${q}"` : ""}.`}
            </li>
          )}
        </ul>

        {/* Footer CTA */}
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
