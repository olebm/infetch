import { Lock, Globe2, FileCode, Shield } from "lucide-react";
import { redirect } from "next/navigation";
import Link from "next/link";
import Image from "next/image";
import { getCurrentAuth } from "@/lib/auth/current";
import { LoginForm } from "@/components/auth/login-form";
import { AuthErrorBanner } from "@/components/auth/auth-error-banner";
import { loginAsTestUser } from "@/app/login/actions";

export const dynamic = "force-dynamic";

// Konsistent mit der Landingpage-Sicherheits-Sektion (Cloud-SaaS, EU-Hosting).
const TRUST_ITEMS = [
  { icon: Globe2,   label: "EU-Server",       detail: "Frankfurt"        },
  { icon: Lock,     label: "Verschlüsselt",   detail: "AES-256"          },
  { icon: Shield,   label: "DSGVO",           detail: "AVV inklusive"    },
  { icon: FileCode, label: "Volle Kontrolle", detail: "Export jederzeit" },
];

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string; error?: string }>;
}) {
  const params = await searchParams;
  const rawNext = params.next ?? "/";
  const queryError = params.error;
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
              <img src="/images/brand/infetch-logo.svg" alt="Infetch" className="h-9 w-auto" />
            </Link>
          </div>

          {/* Tagline */}
          <div className="mt-6">
            <p className="font-display text-2xl text-ink leading-[1.08] max-w-[22ch]">
              Rechnungen, die sich <em>selbst</em> weiterleiten.
            </p>
            <p className="mt-3 text-sm text-muted leading-relaxed max-w-[30ch]">
              Postfach verbinden — Infetch erledigt den Rest automatisch.
            </p>
          </div>

          {/* Photo */}
          <div className="flex-1 flex items-center justify-center py-4">
            <div className="relative w-full max-w-[280px] rounded-xl overflow-hidden shadow-lift" style={{ aspectRatio: "2/3" }}>
              <Image
                src="/images/photos/login-window.webp"
                alt="Person blickt ruhig aus dem Fenster — alles läuft automatisch"
                fill
                className="object-cover object-center"
                sizes="280px"
                priority
              />
            </div>
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
                <img src="/images/brand/infetch-logo.svg" alt="Infetch" className="h-9 w-auto" />
              </Link>
            </div>

            <h1 className="text-2xl font-semibold tracking-tight text-ink">
              Einloggen oder Account erstellen
            </h1>
            <p className="mt-1 text-sm text-muted">
              Wir schicken dir einen Login-Code. Kein Passwort.
            </p>

            <AuthErrorBanner queryError={queryError} />

            {/* Magic-Link Form */}
            <LoginForm next={next} />

            <p className="mt-6 text-xs text-muted">
              Mit Klick auf &bdquo;Login-Code senden&ldquo; akzeptierst du{" "}
              <Link href="/agb" className="underline underline-offset-4 decoration-line hover:text-ink">Nutzungsbedingungen</Link>,{" "}
              <Link href="/datenschutz" className="underline underline-offset-4 decoration-line hover:text-ink">Datenschutz</Link>{" "}
              und{" "}
              <Link href="/avv" className="underline underline-offset-4 decoration-line hover:text-ink">Auftragsverarbeitungsvertrag</Link>.
            </p>

            {process.env.ENABLE_TEST_LOGIN === "true" && (
              <form action={loginAsTestUser} className="mt-4">
                <input type="hidden" name="next" value={next} />
                <button
                  type="submit"
                  data-testid="test-login-btn"
                  className="w-full rounded border border-dashed border-line bg-surface px-3 py-2 text-xs text-muted hover:border-brand hover:text-brand transition-colors"
                >
                  Als Test-User einloggen (nur Dev)
                </button>
              </form>
            )}
          </div>
        </div>

      </main>
    </div>
  );
}
