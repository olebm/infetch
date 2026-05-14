import { Lock, Globe2, FileCode, Shield } from "lucide-react";
import { redirect } from "next/navigation";
import Link from "next/link";
import { loginAsTestUser } from "@/app/login/actions";
import { getCurrentAuth } from "@/lib/auth/current";
import { Button } from "@/components/ui/button";
import { StatusBadge } from "@/components/status/status-badge";

export const dynamic = "force-dynamic";

const TRUST_ITEMS = [
  { icon: Lock,     label: "Daten bei dir",  detail: "lokal in SQLite"      },
  { icon: Globe2,   label: "EU-Hosting",     detail: "Frankfurt"            },
  { icon: FileCode, label: "AGPL",           detail: "Open Source"          },
  { icon: Shield,   label: "DSGVO",          detail: "per Konstruktion"     },
];

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string }>;
}) {
  const params = await searchParams;
  const rawNext = params.next ?? "/";
  const next = rawNext.startsWith("/") && !rawNext.startsWith("//") ? rawNext : "/";

  const auth = await getCurrentAuth();
  if (auth) redirect(next);

  return (
    <div className="flex min-h-screen flex-col bg-surface">
      <main className="grid flex-1 md:grid-cols-2">

        {/* ── Left — white brand panel ──────────────────────────────────── */}
        <div className="hidden flex-col justify-between border-r border-line bg-white p-12 md:flex">
          {/* Logo + beta badge */}
          <div>
            <Link href="/landingpage" aria-label="Zur Startseite">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src="/infetch-logo.svg" alt="Infetch" className="h-8 w-auto" />
            </Link>
            <div className="mt-3">
              <StatusBadge status="new" label="v0.4 · public beta" />
            </div>
          </div>

          {/* Headline */}
          <div>
            <h2 className="text-3xl font-semibold tracking-tight text-ink leading-tight max-w-md">
              Postfach verbinden,<br />fertig.
            </h2>
            <p className="mt-3 max-w-sm text-sm text-muted">
              Rechnungen sammeln sich von selbst und gehen automatisch zur Steuersoftware.
            </p>
          </div>

          {/* Trust strip */}
          <ul className="grid grid-cols-2 gap-4 max-w-sm">
            {TRUST_ITEMS.map((item) => {
              const Icon = item.icon;
              return (
                <li key={item.label} className="flex items-start gap-3">
                  <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded border border-line bg-surface text-muted">
                    <Icon className="h-3.5 w-3.5" aria-hidden />
                  </div>
                  <div>
                    <div className="text-xs font-medium text-ink">{item.label}</div>
                    <div className="text-xs text-muted">{item.detail}</div>
                  </div>
                </li>
              );
            })}
          </ul>
        </div>

        {/* ── Right — login form ────────────────────────────────────────── */}
        <div className="flex items-center justify-center p-6 md:p-12">
          <div className="w-full max-w-sm">

            {/* Mobile: logo + link back to landing */}
            <div className="mb-8 md:hidden">
              <Link href="/landingpage" aria-label="Zur Startseite">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src="/infetch-logo.svg" alt="Infetch" className="h-7 w-auto" />
              </Link>
            </div>

            <h1 className="text-2xl font-semibold tracking-tight text-ink">
              Einloggen oder Account erstellen
            </h1>
            <p className="mt-1 text-sm text-muted">
              Wir schicken dir einen Magic-Link. Kein Passwort.
            </p>

            {/* Form — magic link placeholder */}
            <div className="mt-6 space-y-3">
              <div>
                <label className="mb-1 block text-xs font-medium text-muted">E-Mail</label>
                <input
                  type="email"
                  disabled
                  placeholder="du@studio.de"
                  className="h-10 w-full rounded border border-line bg-surface px-3 text-sm text-muted placeholder:text-muted/60 outline-none cursor-not-allowed"
                />
              </div>
              <button
                type="button"
                disabled
                className="h-10 w-full cursor-not-allowed rounded bg-brand/20 text-sm font-medium text-muted"
                title="Infetch ist aktuell im geschlossenen Beta-Test"
              >
                Magic-Link senden (bald verfügbar)
              </button>
              <p className="text-xs text-muted">
                Infetch ist im geschlossenen Beta-Test. Zugang über Einladung.
              </p>
            </div>

            {/* Dev fallback */}
            {process.env.NODE_ENV !== "production" && (
              <form action={loginAsTestUser} className="mt-4">
                <input type="hidden" name="next" value={next} />
                <Button type="submit" variant="ghost" fullWidth className="text-xs text-muted">
                  Als Test-User einloggen →
                </Button>
              </form>
            )}

            <p className="mt-6 text-xs text-muted">
              Mit Klick auf „Magic-Link senden" akzeptierst du{" "}
              <Link href="/agb" className="underline underline-offset-4 decoration-line hover:text-ink">Nutzungsbedingungen</Link>{" "}
              und{" "}
              <Link href="/datenschutz" className="underline underline-offset-4 decoration-line hover:text-ink">Datenschutz</Link>.
            </p>
          </div>
        </div>

      </main>
    </div>
  );
}
