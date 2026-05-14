import { Lock, Globe2, FileCode, Shield } from "lucide-react";
import { redirect } from "next/navigation";
import Link from "next/link";
import { getCurrentAuth } from "@/lib/auth/current";
import { LoginForm } from "@/components/auth/login-form";

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
          {/* Logo */}
          <div>
            <Link href="https://infetch.de" aria-label="Zur Startseite">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src="/infetch-logo.svg" alt="Infetch" className="h-8 w-auto" />
            </Link>
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
              <Link href="https://infetch.de" aria-label="Zur Startseite">
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

            {/* Magic-Link Form */}
            <LoginForm next={next} />

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
