import Image from "next/image";
import Link from "next/link";
import { VendorLogo } from "@/components/ui/vendor-logo";
import { LogoStrip } from "./logo-strip";
import { ContactController } from "./contact-controller";
import { MobileNav } from "./mobile-nav";
import { appConfig } from "@/lib/config/env";

// ─── Tooltip helper ───────────────────────────────────────────────────────────

function Tip({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <span className="relative group/tip inline-flex">
      {children}
      <span className="hidden md:block pointer-events-none absolute bottom-full left-1/2 -translate-x-1/2 mb-2
                       rounded-md px-2.5 py-1 bg-ink text-white text-[11px] leading-snug
                       whitespace-nowrap opacity-0 group-hover/tip:opacity-100
                       transition-opacity duration-150 z-50 shadow-pop">
        {label}
        <span className="absolute top-full left-1/2 -translate-x-1/2 border-[4px] border-transparent border-t-ink" />
      </span>
    </span>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function LandingPage() {
  // Free-only Launch: kein Preis-/Pro-Marketing auf der Landingpage.
  const proEnabled = appConfig.billing.proEnabled;
  return (
    <div className="overflow-x-hidden">
      {/* ================================================================== */}
      {/* NAV                                                                 */}
      {/* ================================================================== */}
      <header className="sticky top-0 z-40 nav-blur border-b border-line relative">
        <div className="max-w-[1180px] mx-auto px-6 md:px-8 h-16 flex items-center gap-6">
          <Link href="/" className="flex items-center shrink-0" aria-label="Infetch">
            <Image src="/images/brand/infetch-logo.svg" alt="Infetch" width={90} height={28} className="h-9 w-auto" priority />
          </Link>
          <nav className="hidden md:flex items-center gap-6 ml-6 text-sm text-muted">
            <a href="#how" className="hover:text-ink">Wie es funktioniert</a>
            <a href="#features" className="hover:text-ink">Funktionen</a>
            <a href="#sicherheit" className="hover:text-ink">Sicherheit</a>
            {proEnabled && <a href="#preise" className="hover:text-ink">Preise</a>}
            <a href="#faq" className="hover:text-ink">FAQ</a>
          </nav>
          <div className="hidden md:flex items-center gap-2 ml-auto">
            <Link href="https://app.infetch.de/login" className="inline-flex h-9 px-4 text-sm font-medium items-center rounded bg-ink text-white hover:opacity-90">
              Kostenlos starten
            </Link>
          </div>
          {/* Mobile: Anmelden + Hamburger */}
          <div className="md:hidden flex items-center gap-2 ml-auto">
            <Link href="https://app.infetch.de/login" className="inline-flex h-9 px-3 text-sm font-medium items-center rounded bg-ink text-white hover:opacity-90">
              Anmelden
            </Link>
            <MobileNav />
          </div>
        </div>
      </header>

      <main>
      {/* ================================================================== */}
      {/* HERO                                                                */}
      {/* ================================================================== */}
      <section className="relative">
        <div className="max-w-[1180px] mx-auto pl-6 md:pl-8 pr-6 md:pr-8 lg:pr-0 pt-8 md:pt-24 pb-12 md:pb-20 grid md:grid-cols-[1fr_1.1fr] gap-12 lg:gap-14 items-center">

          <div className="min-w-0">
            <Tip label="Scannt dein Postfach alle 5 Minuten nach neuen Rechnungen">
              <div className="inline-flex items-center gap-2 text-xs text-ok cursor-default">
                <span className="w-1.5 h-1.5 rounded-full bg-ok pulse-dot"></span>
                Auto-Pilot · scannt jetzt
              </div>
            </Tip>
            <h1 className="mt-5 font-display text-4xl md:text-5xl lg:text-6xl xl:text-7xl text-ink leading-[1.02] max-w-[18ch]">
              Rechnungen, die <span className="whitespace-nowrap">sich <span className="accent">selbst</span></span> weiterleiten.
            </h1>
            <p className="mt-6 text-lg text-muted max-w-[42ch] leading-relaxed">
              Infetch liest dein Postfach mit, erkennt jede Rechnung und schickt sie an deine Buchhaltung — automatisch.
            </p>
            <p className="mt-3 text-sm text-muted max-w-[42ch]">
              Für Freelancer, Agenturen und kleine Teams mit vielen SaaS-Abos.
            </p>
            <div className="mt-8 flex flex-wrap items-center gap-3">
              <Link href="https://app.infetch.de/login" className="inline-flex h-11 px-5 rounded items-center bg-ink text-white text-sm font-medium hover:opacity-90">
                Kostenlos starten
              </Link>
              <a href="#how" className="inline-flex h-11 px-4 rounded items-center text-sm text-ink ul-link">
                Wie es funktioniert
              </a>
            </div>


            <p className="md:hidden mt-6 text-xs text-muted">
              <span className="text-ink stat-num">≈ 4 Min</span> Einrichtung · <span className="text-ink stat-num">DSGVO</span> · EU-Server · <span className="text-ink stat-num">KI</span> · automatisch
            </p>
            <div className="hidden md:flex flex-wrap items-center gap-x-6 gap-y-2 text-xs text-muted mt-8">
              <Tip label="Postfach verbinden, Empfänger eintragen — fertig.">
                <div className="flex items-center gap-2 cursor-default"><span className="text-ink stat-num">≈ 4 Min</span> Einrichtung</div>
              </Tip>
              <Tip label="Daten auf Hetzner Frankfurt · AVV inklusive">
                <div className="flex items-center gap-2 cursor-default"><span className="text-ink stat-num">DSGVO</span> · EU-Server</div>
              </Tip>
              <Tip label="Erkennt Anbieter, Betrag & Steuersatz automatisch">
                <div className="flex items-center gap-2 cursor-default"><span className="text-ink stat-num">KI</span> · automatisch</div>
              </Tip>
            </div>
          </div>

          {/* HERO VISUAL */}
          <div className="min-w-0 flex flex-col gap-5">
            <div className="relative w-full rounded-lg overflow-hidden shadow-lift" style={{ aspectRatio: "16/9" }}>
              <Image
                src="/images/photos/hero-desk.webp"
                alt="Frau am Schreibtisch prüft automatisch weitergeleitete Rechnungen in Infetch"
                fill
                className="object-cover object-center"
                priority
                sizes="(max-width: 1024px) 100vw, 54vw"
              />
            </div>
            <div className="mock-window shadow-lift">
              <div className="px-5 pt-5 pb-2 flex items-baseline justify-between">
                <div className="font-display text-2xl text-ink">Heute</div>
                <div className="text-[11px] text-muted stat-num">14. Mai 2026 · 14:32</div>
              </div>

              <ul className="px-2 pb-3">
                {[
                  { domain: "github.com", label: "GitHub · Copilot Business",    meta: "09:14 · 19,00 €"  },
                  { domain: "adobe.com",  label: "Adobe Systems · Creative Cloud", meta: "11:02 · 77,99 €" },
                ].map(({ domain, label, meta }) => (
                  <li key={domain} className="row-hover px-3 py-3 flex items-center gap-4 border-b border-line">
                    <VendorLogo domain={domain} name={label} size={44} />
                    <div className="flex-1 min-w-0">
                      <div className="text-sm font-medium text-ink truncate">{label}</div>
                      <div className="mt-0.5 text-xs text-muted stat-num">{meta}</div>
                    </div>
                    <span className="inline-flex items-center gap-1.5">
                      <span className="inline-block h-1.5 w-1.5 shrink-0 rounded-full bg-ok"></span>
                      <span className="text-xs text-muted">verschickt</span>
                    </span>
                  </li>
                ))}

                {/* Cycling animated row — 3 vendors rotate every 8 s */}
                <li className="relative border-b border-line" style={{ height: "68px" }}>
                  {[
                    { domain: "slack.com", label: "Slack Technologies · Pro",   meta: "jetzt · 8,75 €"  },
                    { domain: "notion.so", label: "Notion Labs · Team Plan",    meta: "jetzt · 16,00 €" },
                    { domain: "figma.com", label: "Figma Inc. · Professional",  meta: "jetzt · 15,00 €" },
                  ].map(({ domain, label, meta }, i) => (
                    <div key={domain} className="anim-row absolute inset-0 px-3 flex items-center gap-4" style={{ animationDelay: `${i * 8}s` }}>
                      <VendorLogo domain={domain} name={label} size={44} />
                      <div className="flex-1 min-w-0">
                        <div className="text-sm font-medium text-ink truncate">{label}</div>
                        <div className="mt-0.5 text-xs text-muted stat-num">{meta}</div>
                      </div>
                      <div className="relative" style={{ minWidth: "72px", height: "20px" }}>
                        <span className="anim-badge absolute inset-0 inline-flex items-center justify-end gap-1.5 whitespace-nowrap" style={{ animationDelay: `${i * 8}s` }}>
                          <span className="inline-block h-1.5 w-1.5 shrink-0 rounded-full bg-warn-vivid"></span>
                          <span className="text-xs text-muted">erkannt</span>
                        </span>
                        <span className="anim-sent absolute inset-0 inline-flex items-center justify-end gap-1.5 whitespace-nowrap" style={{ animationDelay: `${i * 8}s` }}>
                          <span className="inline-block h-1.5 w-1.5 shrink-0 rounded-full bg-ok"></span>
                          <span className="text-xs text-muted">verschickt</span>
                        </span>
                      </div>
                    </div>
                  ))}
                </li>

                <li className="row-hover px-3 py-3 flex items-center gap-4">
                  <VendorLogo domain="canva.com" name="Canva Pty Ltd · Pro Plan" size={44} />
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-medium text-ink truncate">Canva Pty Ltd · Pro Plan</div>
                    <div className="mt-0.5 text-xs text-muted stat-num">gestern · 14,99 €</div>
                  </div>
                  <span className="inline-flex items-center gap-1.5">
                    <span className="inline-block h-1.5 w-1.5 shrink-0 rounded-full bg-ok"></span>
                    <span className="text-xs text-muted">verschickt</span>
                  </span>
                </li>
              </ul>

              <div className="px-5 py-3 border-t border-line bg-surface flex items-center justify-between text-xs text-muted">
                <span>nächster Scan in <span className="text-ink stat-num">2:14</span></span>
                <span className="stat-num">247 Rechnungen · Mai 2026</span>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ================================================================== */}
      {/* TRUST RIEGEL                                                        */}
      {/* ================================================================== */}
      <section className="border-t border-line bg-paper">
        <div className="max-w-[1180px] mx-auto px-6 md:px-8 py-6">
          <p className="text-center text-sm text-ink leading-relaxed max-w-2xl mx-auto">
            Nur erkannte Rechnungs-PDFs werden gespeichert — der Rest deines
            Postfachs bleibt unberührt und wird nie gespeichert.
          </p>
          <div className="mt-4 flex flex-wrap justify-center items-center gap-x-6 gap-y-2 text-xs text-muted">
            {[
              "Verschlüsselt (AES-256)",
              "EU-Server · Frankfurt",
              "Keine KI-Trainingsnutzung",
              "Jederzeit löschbar",
              "AVV inklusive",
            ].map((t, i) => (
              <span key={t} className="flex items-center gap-2">
                {i > 0 && <span className="hidden sm:inline w-1 h-1 rounded-full bg-muted/40" />}
                {t}
              </span>
            ))}
          </div>
        </div>
      </section>

      {/* ================================================================== */}
      {/* LOGO STRIP                                                          */}
      {/* ================================================================== */}
      <section className="border-y border-line bg-paper">
        <div className="max-w-[1180px] mx-auto px-6 md:px-8 py-10">
          <div className="text-[11px] uppercase tracking-[0.14em] text-muted text-center mb-7">
            Erkennt Rechnungen von
          </div>
          <LogoStrip />
          <div className="mt-6 text-center text-xs text-muted">
            Und alle weiteren — die KI erkennt Absender und Betrag automatisch.
          </div>
        </div>
      </section>

      {/* ================================================================== */}
      {/* PROBLEM FRAME                                                       */}
      {/* ================================================================== */}
      <section className="border-b border-line">
        <div className="max-w-[1180px] mx-auto px-6 md:px-8">
          <div className="grid md:grid-cols-[1fr_1.1fr] gap-0 md:gap-12 items-stretch">
            <div className="relative hidden md:block min-h-[400px] my-10 rounded-lg overflow-hidden">
              <Image
                src="/images/photos/problem-invoices.webp"
                alt="Stapel ungeordneter Rechnungen und Belege auf einem Schreibtisch — das typische Chaos vor Infetch"
                fill
                className="object-cover object-center"
                sizes="45vw"
              />
            </div>
            <div className="divide-y divide-line">
              {[
                { eyebrow: "Kein System",  title: "Rechnungen in jedem Postfach",      body: "Adobe, Hetzner, 1&1 — jeder Anbieter schickt von einer anderen Adresse, in ein anderes Postfach." },
                { eyebrow: "Zeitverlust", title: "Jeden Monat manuell suchen",          body: "Filtern, runterladen, weiterleiten — für jede einzelne Rechnung, jeden Monat, von vorne." },
                { eyebrow: "Zu spät",     title: "Die Buchhaltung fragt. Du suchst.",  body: "Stunden damit verbracht, Belege zu finden, die längst hätten weitergeleitet sein sollen." },
              ].map(({ eyebrow, title, body }) => (
                <div key={title} className="py-8 md:py-10">
                  <div className="text-[11px] uppercase tracking-[0.14em] text-muted">{eyebrow}</div>
                  <div className="mt-2 font-display text-2xl text-ink">{title}</div>
                  <p className="mt-2 text-sm text-muted leading-relaxed">{body}</p>
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>

      {/* ================================================================== */}
      {/* WIE ES FUNKTIONIERT                                                 */}
      {/* ================================================================== */}
      <section id="how" className="py-20 md:py-28">
        <div className="max-w-[1180px] mx-auto px-6 md:px-8">
          <div className="max-w-2xl">
            <div className="text-[11px] uppercase tracking-[0.14em] text-muted">So funktioniert es</div>
            <h2 className="mt-3 font-display text-4xl md:text-5xl text-ink leading-[1.05]">
              In vier Minuten verbunden.<br className="hidden md:block" />
              {" "}Danach läuft alles ohne dich.
            </h2>
          </div>

          <div className="mt-14 grid md:grid-cols-3 gap-x-10 gap-y-12 reveal" id="how-steps">
            {/* step 1 */}
            <div className="flex flex-col">
              <div className="text-xs text-muted stat-num">01</div>
              <h3 className="mt-2 font-display text-2xl text-ink">Postfach verbinden</h3>
              <p className="mt-2 text-muted leading-relaxed min-h-[4.5rem]">
                Verbinde Gmail, Outlook oder einen IMAP-Anbieter in Minuten.
                Zugangsdaten verschlüsselt gespeichert — nie im Klartext.
              </p>
              <div className="mt-6 mock-window">
                <div className="px-4 py-3 border-b border-line flex items-center gap-2">
                  <VendorLogo domain="google.com" name="Gmail" size={24}/>
                  <div className="text-xs text-ink">kontakt@beispiel.de</div>
                  <span className="ml-auto inline-flex items-center gap-1.5 text-[11px] text-ok">
                    <span className="w-1.5 h-1.5 rounded-full bg-ok"></span>verbunden
                  </span>
                </div>
                <div className="px-4 py-3 text-xs text-muted stat-num">IMAP · alle 5 Min</div>
              </div>
            </div>

            {/* step 2 */}
            <div className="flex flex-col">
              <div className="text-xs text-muted stat-num">02</div>
              <h3 className="mt-2 font-display text-2xl text-ink">Wir erkennen</h3>
              <p className="mt-2 text-muted leading-relaxed min-h-[4.5rem]">
                KI liest Anbieter, Betrag und Steuersatz direkt aus dem PDF.
                Unsichere Erkennungen warten auf dein OK.
              </p>
              <div className="mt-6 mock-window">
                <div className="px-4 py-3 border-b border-line flex items-center gap-2">
                  <VendorLogo domain="adobe.com" name="Adobe" size={24}/>
                  <div className="text-xs text-ink truncate">Adobe · Creative Cloud</div>
                  <span className="ml-auto text-[11px] text-ink stat-num">77,99 €</span>
                </div>
                <div className="px-4 py-3 flex items-center justify-between text-xs">
                  <span className="text-muted">Konfidenz</span>
                  <span className="text-ink stat-num">98 %</span>
                </div>
              </div>
            </div>

            {/* step 3 */}
            <div className="flex flex-col">
              <div className="text-xs text-muted stat-num">03</div>
              <h3 className="mt-2 font-display text-2xl text-ink">Automatisch weiter</h3>
              <p className="mt-2 text-muted leading-relaxed min-h-[4.5rem]">
                Das erkannte PDF geht sofort an deinen Empfänger — ohne dein Zutun.
                Jeden Schritt siehst du im Audit-Log.
              </p>
              <div className="mt-6 mock-window">
                <div className="px-4 py-3 border-b border-line flex items-center gap-2">
                  <div className="text-xs text-muted">an</div>
                  <div className="text-xs text-ink font-mono truncate">buchhaltung@beispiel.de</div>
                </div>
                <div className="px-4 py-3 flex items-center justify-between text-xs">
                  <span className="text-muted">Status</span>
                  <span className="inline-flex items-center gap-1.5 text-ok">
                    <span className="w-1.5 h-1.5 rounded-full bg-ok"></span>versendet
                  </span>
                </div>
              </div>
            </div>
          </div>

          {/* CTA nach Steps */}
          <div className="mt-14 pt-10 border-t border-line">
            <Link href="https://app.infetch.de/login" className="inline-flex h-12 px-8 rounded items-center bg-ink text-white text-base font-medium hover:opacity-90">
              Jetzt kostenlos starten
            </Link>
            <p className="mt-3 text-sm text-muted">
              Setup in 4 Minuten · keine Kreditkarte · monatlich kündbar
            </p>
          </div>
        </div>
      </section>

      {/* ================================================================== */}
      {/* STATS STRIP                                                         */}
      {/* ================================================================== */}
      <section className="bg-ink text-white border-b border-white/10">
        <div className="max-w-[1180px] mx-auto px-6 md:px-8 py-12 grid grid-cols-2 md:grid-cols-4 gap-8">
          {[
            { value: "≈ 4 Min", label: "Einrichtung — danach läuft alles allein" },
            { value: "KI",       label: "erkennt Anbieter, Betrag & Steuersatz automatisch" },
            { value: "0 €",      label: "kostenlos starten · keine Kreditkarte" },
            { value: "EU",       label: "Server in Frankfurt · DSGVO · AVV inklusive" },
          ].map(({ value, label }) => (
            <div key={label}>
              <div className="font-display text-4xl md:text-5xl text-white stat-num">{value}</div>
              <div className="mt-2 text-sm text-white/50 leading-snug">{label}</div>
            </div>
          ))}
        </div>
      </section>

      {/* ================================================================== */}
      {/* FEATURES                                                            */}
      {/* ================================================================== */}
      <section id="features" className="py-20 md:py-28 bg-paper border-y border-line">
        <div className="max-w-[1180px] mx-auto px-6 md:px-8">
          <div className="max-w-2xl">
            <div className="text-[11px] uppercase tracking-[0.14em] text-muted">Funktionen</div>
            <h2 className="mt-3 font-display text-4xl md:text-5xl text-ink leading-[1.05]">
              Sortiert. Sortiert wirklich.
            </h2>
            <p className="mt-5 text-muted text-lg leading-relaxed max-w-xl">
              Kein Sammelordner, keine Excel-Liste, kein Suchen.
              Jede Rechnung dort, wo sie hingehört.
            </p>
          </div>

          <div className="mt-16 grid md:grid-cols-2 gap-x-12 gap-y-16">
            {/* feature 1 */}
            <div className="flex flex-col">
              <h3 className="font-display text-2xl text-ink">Alle Anbieter auf einem Blick</h3>
              <p className="mt-2 text-muted leading-relaxed min-h-[3rem]">
                Jeder Anbieter mit eigener Seite, Summe pro Monat, Frequenz-Erkennung.
              </p>
              <div className="mt-6 mock-window">
                <ul className="divide-y divide-line">
                  {[
                    { domain: "hetzner.com",   name: "Hetzner Online",      count: "14 Rechnungen · monatlich", sum: "385,70 €" },
                    { domain: "microsoft.com", name: "Microsoft Corporation", count: "4 Rechnungen · monatlich",  sum: "250,00 €" },
                    { domain: "adobe.com",     name: "Adobe Systems",        count: "5 Rechnungen · monatlich",  sum: "389,95 €" },
                  ].map(({ domain, name, count, sum }) => (
                    <li key={domain} className="px-4 py-3 flex items-center gap-4 row-hover">
                      <VendorLogo domain={domain} name={name} size={36} />
                      <div className="flex-1 min-w-0">
                        <div className="text-sm font-medium text-ink truncate">{name}</div>
                        <div className="mt-0.5 text-xs text-muted stat-num">{count}</div>
                      </div>
                      <div className="text-sm text-ink stat-num">{sum}</div>
                    </li>
                  ))}
                </ul>
              </div>
            </div>

            {/* feature 2 */}
            <div className="flex flex-col">
              <h3 className="font-display text-2xl text-ink">Privat bleibt privat</h3>
              <p className="mt-2 text-muted leading-relaxed min-h-[3rem]">
                Ein Klick auf „privat“ — Anbieter oder Mail landet nie in der Buchhaltung.
              </p>
              <div className="mt-6 mock-window">
                <div className="px-4 py-3 border-b border-line flex items-center gap-4">
                  <VendorLogo domain="spotify.com" name="Spotify" size={36} />
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-medium text-ink truncate">Spotify · Premium Familie</div>
                    <div className="mt-0.5 text-xs text-muted stat-num">spotify.com · 9,99 €</div>
                  </div>
                </div>
                <div className="px-4 py-3 flex flex-col gap-2">
                  <button className="text-left text-sm text-ink hover:bg-surface rounded px-2 py-1.5">
                    <span className="font-medium">Nur diese Rechnung</span>
                    <span className="text-muted block text-xs">einmalig ausschließen</span>
                  </button>
                  <button className="text-left text-sm text-ink hover:bg-surface rounded px-2 py-1.5">
                    <span className="font-medium">Alle künftigen von spotify.com</span>
                    <span className="text-muted block text-xs">Domain immer ignorieren</span>
                  </button>
                </div>
              </div>
            </div>

            {/* feature 3 */}
            <div className="flex flex-col">
              <h3 className="font-display text-2xl text-ink">Wir merken, wenn etwas fehlt</h3>
              <p className="mt-2 text-muted leading-relaxed min-h-[3rem]">
                Monatliche Rechnungen, die ausbleiben, melden wir — bevor die Buchhaltung fragt.
              </p>
              <div className="mt-6 mock-window">
                <ul className="divide-y divide-line">
                  {[
                    { domain: "notion.so",  name: "Notion Team Plan",   expect: "erwartet 02. Mai · 32,00 €", label: "3 Tage spät",   cls: "text-warn" },
                    { domain: "figma.com",  name: "Figma Inc.",          expect: "erwartet 12. Mai · 45,00 €", label: "heute fällig",  cls: "text-muted" },
                    { domain: "dropbox.com", name: "Dropbox Business",    expect: "erwartet 14. Mai · 13,99 €", label: "in 2 Tagen",   cls: "text-muted" },
                  ].map(({ domain, name, expect, label, cls }) => (
                    <li key={domain} className="px-4 py-3 flex items-center gap-4 row-hover">
                      <VendorLogo domain={domain} name={name} size={36} />
                      <div className="flex-1 min-w-0">
                        <div className="text-sm font-medium text-ink truncate">{name}</div>
                        <div className="mt-0.5 text-xs text-muted stat-num">{expect}</div>
                      </div>
                      <span className={`text-xs ${cls}`}>{label}</span>
                    </li>
                  ))}
                </ul>
              </div>
            </div>

            {/* feature 4 */}
            <div className="flex flex-col">
              <h3 className="font-display text-2xl text-ink">Mehrere Empfänger</h3>
              <p className="mt-2 text-muted leading-relaxed min-h-[3rem]">
                Primär, sekundär, oder eigene Adresse — jede Rechnung dorthin, wo sie hin soll.
              </p>
              <div className="mt-6 mock-window">
                <ul className="divide-y divide-line">
                  {[
                    { domain: "lexoffice.de", name: "lexoffice", label: "Primär",   email: "belege@lexoffice.de"  },
                    { domain: "sevdesk.de",   name: "sevDesk",   label: "Sekundär", email: "buchhaltung@studio.de"},
                    { domain: "datev.de",     name: "DATEV",     label: "Kopie",    email: "steuer@kanzlei.de"   },
                  ].map(({ domain, name, label, email }) => (
                    <li key={label} className="px-4 py-3 flex items-center gap-4 row-hover">
                      <VendorLogo domain={domain} name={name} size={36} />
                      <div className="flex-1 min-w-0">
                        <div className="text-sm font-medium text-ink">{name}</div>
                        <div className="mt-0.5 text-xs text-muted stat-num truncate">{email}</div>
                      </div>
                      <span className="text-xs text-muted shrink-0">{label}</span>
                    </li>
                  ))}
                </ul>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ================================================================== */}
      {/* SICHERHEIT                                                          */}
      {/* ================================================================== */}
      <section id="sicherheit" className="py-20 md:py-28">
        <div className="max-w-[1180px] mx-auto px-6 md:px-8">
          <div className="grid md:grid-cols-[1fr_1.1fr] gap-10 md:gap-20 items-start">
            <div>
              <div className="text-[11px] uppercase tracking-[0.14em] text-muted">Sicherheit &amp; Datenschutz</div>
              <h2 className="mt-3 font-display text-4xl md:text-5xl text-ink leading-[1.05]">
                Deine Mails sind deine Sache.
              </h2>
              <p className="mt-5 text-muted leading-relaxed">
                Infetch filtert gezielt auf Rechnungsmerkmale und speichert
                ausschließlich erkannte Belege — verschlüsselt, auf Servern in
                Frankfurt. Dein restliches Postfach bleibt unberührt, und du
                kannst alle Daten jederzeit vollständig löschen.
              </p>
              <div className="mt-6">
                <Link href="/datenschutz" className="text-sm ul-link text-muted hover:text-ink">
                  Datenschutzerklärung lesen
                </Link>
              </div>
            </div>

            <div className="flex flex-col gap-8">
              <div className="relative w-full rounded-lg overflow-hidden" style={{ aspectRatio: "3/2" }}>
                <Image
                  src="/images/photos/trust-cafe.webp"
                  alt="Entspannte Freelancerin im Café — Infetch erledigt die Buchhaltung automatisch"
                  fill
                  className="object-cover object-center"
                  sizes="(max-width: 768px) 100vw, 50vw"
                />
              </div>
            <dl className="grid grid-cols-2 gap-y-8 gap-x-8">
              {[
                { label: "Standort",        value: "EU · Frankfurt", detail: "Hetzner · ISO 27001"           },
                { label: "Verschlüsselung", value: "AES-256",        detail: "at rest · in transit"          },
                { label: "DSGVO",           value: "AVV inklusive",  detail: "Art. 28 DSGVO"                 },
                { label: "KI-Training",     value: "keine",          detail: "Deine Daten trainieren nichts" },
              ].map(({ label, value, detail }) => (
                <div key={label}>
                  <dt className="text-xs text-muted">{label}</dt>
                  <dd className="mt-1 font-display text-2xl text-ink">{value}</dd>
                  <dd className="text-xs text-muted mt-1">{detail}</dd>
                </div>
              ))}
            </dl>
            </div>
          </div>
        </div>
      </section>

      {/* ================================================================== */}
      {/* INTEGRATIONEN                                                       */}
      {/* ================================================================== */}
      <section className="py-20 md:py-28 border-y border-line">
        <div className="max-w-[1180px] mx-auto px-6 md:px-8">
          <div className="max-w-2xl">
            <div className="text-[11px] uppercase tracking-[0.14em] text-muted">Integrationen</div>
            <h2 className="mt-3 font-display text-4xl md:text-5xl text-ink leading-[1.05]">
              Spricht mit allem, was du schon hast.
            </h2>
          </div>

          <div className="mt-14 grid md:grid-cols-2 gap-12">
            <div>
              <div className="text-xs uppercase tracking-[0.14em] text-muted">Postfächer</div>
              <ul className="mt-5 flex flex-wrap gap-3">
                {[
                  { domain: "google.com",  label: "Gmail · Workspace" },
                  { domain: "microsoft.com", label: "Microsoft 365"   },
                  { domain: "icloud.com",  label: "Apple iCloud"      },
                  { domain: null,          label: "IMAP (universal)"  },
                ].map(({ domain, label }) => (
                  <li key={label} className="relative group/tip h-12 w-12 logo-tile rounded-full flex items-center justify-center cursor-default overflow-hidden">
                    {domain
                      ? <VendorLogo domain={domain} name={label} size={40} />
                      : <span className="text-xl text-muted font-medium">@</span>}
                    <span className="pointer-events-none absolute bottom-full left-1/2 -translate-x-1/2 mb-2 rounded-md px-2.5 py-1 bg-ink text-white text-[11px] leading-snug whitespace-nowrap opacity-0 group-hover/tip:opacity-100 transition-opacity duration-150 z-50 shadow-pop">
                      {label}
                      <span className="absolute top-full left-1/2 -translate-x-1/2 border-[4px] border-transparent border-t-ink" />
                    </span>
                  </li>
                ))}
              </ul>
            </div>
            <div>
              <div className="text-xs uppercase tracking-[0.14em] text-muted">Empfänger · Buchhaltung</div>
              <ul className="mt-5 flex flex-wrap gap-3">
                {[
                  { domain: "datev.de",       label: "DATEV Belegtransfer" },
                  { domain: "xero.com",        label: "Xero"                },
                  { domain: "sevdesk.de",      label: "sevdesk"             },
                  { domain: "quickbooks.com",  label: "QuickBooks"          },
                  { domain: "lexoffice.de",    label: "lexoffice"           },
                  { domain: "sage.com",        label: "Sage"                },
                  { domain: "candis.io",       label: "Candis"              },
                  { domain: null,              label: "Beliebige E-Mail"    },
                ].map(({ domain, label }) => (
                  <li key={label} className="relative group/tip h-12 w-12 logo-tile rounded-full flex items-center justify-center cursor-default overflow-hidden">
                    {domain
                      ? <VendorLogo domain={domain} name={label} size={40} />
                      : <span className="text-xl text-muted font-medium">@</span>}
                    <span className="pointer-events-none absolute bottom-full left-1/2 -translate-x-1/2 mb-2 rounded-md px-2.5 py-1 bg-ink text-white text-[11px] leading-snug whitespace-nowrap opacity-0 group-hover/tip:opacity-100 transition-opacity duration-150 z-50 shadow-pop">
                      {label}
                      <span className="absolute top-full left-1/2 -translate-x-1/2 border-[4px] border-transparent border-t-ink" />
                    </span>
                  </li>
                ))}
              </ul>
              <p className="mt-4 text-xs text-muted">Dein Tool fehlt? Per E-Mail funktioniert immer.</p>
            </div>
          </div>
        </div>
      </section>

      {/* ================================================================== */}
      {/* FOTO 2 — Autopilot-Moment                                          */}
      {/* ================================================================== */}
      <section className="border-b border-line py-20 md:py-28">
        <div className="max-w-[1180px] mx-auto px-6 md:px-8 grid md:grid-cols-2 gap-12 items-center">
          <div className="relative max-w-xs mx-auto md:mx-0 w-full rounded-lg overflow-hidden" style={{ aspectRatio: "3/4" }}>
            <Image
              src="/images/photos/autopilot-street.webp"
              alt="Mann spaziert entspannt durch Hamburg mit Kaffee — Infetch läuft automatisch"
              fill
              className="object-cover object-center"
              sizes="(max-width: 768px) 80vw, 30vw"
            />
          </div>
          <div>
            <div className="text-[11px] uppercase tracking-[0.14em] text-muted">Läuft ohne dich</div>
            <h2 className="mt-3 font-display text-4xl md:text-5xl text-ink leading-[1.05]">
              Dein Postfach.<br />Deine Zeit zurück.
            </h2>
            <p className="mt-5 text-muted leading-relaxed">
              Infetch arbeitet im Hintergrund — auch wenn du es nicht tust. Jede Rechnung landet dort, wo sie hingehört.
            </p>
            <div className="mt-8">
              <Link href="https://app.infetch.de/login" className="inline-flex h-11 px-6 rounded items-center bg-ink text-white text-sm font-medium hover:opacity-90">
                Jetzt kostenlos starten
              </Link>
            </div>
          </div>
        </div>
      </section>

      {/* ================================================================== */}
      {/* PREISE                                                              */}
      {/* ================================================================== */}
      {proEnabled && (
      <section id="preise" className="py-20 md:py-28 bg-paper border-y border-line">
        <div className="max-w-[1180px] mx-auto px-6 md:px-8">
          <div className="max-w-2xl">
            <div className="text-[11px] uppercase tracking-[0.14em] text-muted">Preise</div>
            <h2 className="mt-3 font-display text-4xl md:text-5xl text-ink leading-[1.05]">
              Zwei Tarife. Kein Kleingedrucktes.
            </h2>
            <p className="mt-5 text-muted leading-relaxed">
              Kostenlos starten. Keine Kreditkarte. Monatlich kündbar.
            </p>
          </div>

          <div className="mt-14 grid md:grid-cols-2 gap-8 max-w-4xl">
            {/* Plan: Free */}
            <div className="border border-line rounded-2xl p-8 bg-white flex flex-col">
              <div className="text-sm text-muted">Free</div>
              <div className="mt-4 font-display text-5xl text-ink stat-num">0 €</div>
              <div className="text-xs text-muted mt-1">/ dauerhaft kostenlos</div>
              <p className="mt-5 text-sm text-muted leading-relaxed">
                Zum Ausprobieren — kein Ablaufdatum.
              </p>
              <ul className="mt-6 space-y-3 text-sm text-ink flex-1">
                <li className="flex items-center gap-2"><span className="w-1 h-1 rounded-full bg-muted/50 shrink-0"></span>30 Rechnungen / Monat</li>
                <li className="flex items-center gap-2"><span className="w-1 h-1 rounded-full bg-muted/50 shrink-0"></span>1 Postfach (IMAP)</li>
                <li className="flex items-center gap-2"><span className="w-1 h-1 rounded-full bg-muted/50 shrink-0"></span>Auto-Pilot aktiv</li>
                <li className="flex items-center gap-2"><span className="w-1 h-1 rounded-full bg-muted/50 shrink-0"></span>500 MB Speicher</li>
                <li className="flex items-center gap-2"><span className="w-1 h-1 rounded-full bg-muted/50 shrink-0"></span>E-Mail-Support</li>
              </ul>
              <Link href="https://app.infetch.de/login" className="mt-8 inline-flex h-11 px-5 items-center justify-center rounded-lg border border-ink/30 text-sm text-ink hover:bg-surface">
                Kostenlos starten
              </Link>
            </div>

            {/* Plan: Pro (highlighted) */}
            <div className="border-2 border-ink rounded-2xl p-8 bg-white flex flex-col relative">
              <div className="absolute -top-3.5 left-7 inline-flex items-center gap-1 px-3 py-1 rounded-full bg-ink text-white text-[10px] uppercase tracking-[0.14em]">
                empfohlen
              </div>
              <div className="text-sm text-muted">Pro</div>
              <div className="mt-4 flex items-baseline gap-2">
                <span className="font-display text-5xl text-ink stat-num">19 €</span>
              </div>
              <div className="text-xs text-muted mt-1">/ Monat · zzgl. USt.</div>
              <p className="mt-5 text-sm text-muted leading-relaxed">
                Alles inklusive — für alle, die auf nichts verzichten wollen.
              </p>
              <ul className="mt-6 space-y-3 text-sm text-ink flex-1">
                <li className="flex items-center gap-2"><span className="w-1 h-1 rounded-full bg-ink shrink-0"></span>150 Rechnungen / Monat</li>
                <li className="flex items-center gap-2"><span className="w-1 h-1 rounded-full bg-ink shrink-0"></span>Bis zu 3 Postfächer</li>
                <li className="flex items-center gap-2"><span className="w-1 h-1 rounded-full bg-ink shrink-0"></span>2 GB Speicher</li>
                <li className="flex items-center gap-2"><span className="w-1 h-1 rounded-full bg-ink shrink-0"></span>Export zu Lexoffice &amp; sevDesk</li>
                <li className="flex items-center gap-2"><span className="w-1 h-1 rounded-full bg-ink shrink-0"></span>Retroaktiver 12-Monats-Scan</li>
                <li className="flex items-center gap-2"><span className="w-1 h-1 rounded-full bg-ink shrink-0"></span>Bulk-Download (ZIP)</li>
                <li className="flex items-center gap-2"><span className="w-1 h-1 rounded-full bg-ink shrink-0"></span>Prioritäts-Support</li>
              </ul>
              <Link href="https://app.infetch.de/login" className="mt-8 inline-flex h-11 px-5 items-center justify-center rounded-lg bg-ink text-white text-sm font-medium hover:opacity-90">
                Pro wählen
              </Link>
            </div>
          </div>

          <div className="mt-8 text-xs text-muted">
            Besondere Anforderungen?{" "}
            <button type="button" data-contact="" className="ul-link">Sprich mit uns.</button>
          </div>
        </div>
      </section>
      )}

      {/* ================================================================== */}
      {/* FAQ                                                                 */}
      {/* ================================================================== */}
      <section id="faq" className="py-20 md:py-28">
        <div className="max-w-[1180px] mx-auto px-6 md:px-8 grid md:grid-cols-[1fr_1.5fr] gap-12">
          <div>
            <div className="text-[11px] uppercase tracking-[0.14em] text-muted">FAQ</div>
            <h2 className="mt-3 font-display text-4xl md:text-5xl text-ink leading-[1.05]">
              Häufig gefragt.
            </h2>
            <p className="mt-5 text-muted leading-relaxed">
              Noch eine andere Frage?{" "}
              <button type="button" data-contact="" className="ul-link">hallo@infetch.de</button>
            </p>
          </div>

          <div className="divide-y divide-line border-t border-b border-line">
            {[
              {
                q: "Liest Infetch wirklich alle meine Mails?",
                a: "Nein. Wir scannen Mails auf Rechnungsmerkmale — Absender-Muster, PDF-Anhänge, Betreff-Stichwörter. Nur erkannte Belege werden gespeichert. Private Nachrichten werden nicht gespeichert und nicht weiterverarbeitet.",
              },
              {
                q: "Was passiert, wenn die KI sich irrt?",
                a: "Unsichere Fälle gehen nicht raus — sie landen im Posteingang und warten auf dein OK. Du korrigierst einmal, der Agent lernt.",
              },
              {
                q: "Wer sieht meine Rechnungen?",
                a: "Nur du und die Empfänger, die du selbst hinterlegst. Kein Mensch außer dir hat Zugriff auf deine Belegdaten.",
              },
              {
                q: "Brauche ich technisches Wissen?",
                a: "Nein. Postfach verbinden, Empfänger eintragen, fertig. Vier Minuten.",
              },
              {
                q: "Kann ich Anbieter ausschließen?",
                a: "Ja, pro Mail oder pro Domain. Spotify, Netflix oder die private Stromabrechnung kommen nie an die Buchhaltung.",
              },
              {
                q: "Wie kündige ich?",
                a: "Monatlich kündbar, direkt über dein Stripe-Kundenkonto. Auf Wunsch löschen wir deine Daten vollständig — schreib uns einfach an.",
              },
            ].map(({ q, a }) => (
              <details key={q} className="py-5">
                <summary className="flex items-center justify-between gap-4">
                  <span className="font-display text-lg text-ink">{q}</span>
                  <span className="faq-icon text-2xl text-muted leading-none">+</span>
                </summary>
                <p className="mt-3 text-muted leading-relaxed">{a}</p>
              </details>
            ))}
          </div>
        </div>
      </section>

      </main>
      {/* ================================================================== */}
      {/* FOOTER CTA                                                          */}
      {/* ================================================================== */}
      <section className="bg-ink text-white py-20 md:py-28">
        <div className="max-w-[1180px] mx-auto px-6 md:px-8 text-center">
          <div className="text-[11px] uppercase tracking-[0.14em] text-white/50">Dauerhaft kostenlos starten</div>
          <h2 className="mt-3 font-display text-5xl md:text-6xl leading-[1.02] max-w-3xl mx-auto text-white">
            Du suchst seit Jahren nach Belegen.<br className="hidden md:block" />
            {" "}<span className="text-white/50">Ab heute nicht mehr.</span>
          </h2>
          <div className="mt-10 flex flex-wrap justify-center items-center gap-4">
            <Link href="https://app.infetch.de/login" className="inline-flex h-12 px-6 items-center rounded bg-white text-ink text-sm font-medium hover:opacity-90">
              Kostenlos starten
            </Link>
          </div>
          <div className="mt-6 text-xs text-white/50">
            Keine Kreditkarte · Setup in 4 Min · DSGVO-konform
          </div>
        </div>
      </section>

      {/* ================================================================== */}
      {/* FOOTER                                                              */}
      {/* ================================================================== */}
      <footer className="border-t border-line bg-paper">
        <div className="max-w-[1180px] mx-auto px-6 md:px-8 py-10 grid md:grid-cols-[1.2fr_repeat(3,1fr)] gap-10 md:gap-16">
          <div>
            <Image src="/images/brand/infetch-logo.svg" alt="Infetch" width={90} height={28} className="h-9 w-auto opacity-90" />
            <p className="mt-4 text-sm text-muted leading-relaxed max-w-xs">
              Rechnungen, die sich selbst weiterleiten. Made in Hamburg.
            </p>
          </div>
          <div>
            <div className="text-xs uppercase tracking-[0.14em] text-muted">Produkt</div>
            <ul className="mt-3 space-y-2 text-sm text-ink">
              <li><a href="#how" className="hover:text-muted">Wie es funktioniert</a></li>
              <li><a href="#features" className="hover:text-muted">Funktionen</a></li>
              {proEnabled && <li><a href="#preise" className="hover:text-muted">Preise</a></li>}
            </ul>
          </div>
          <div>
            <div className="text-xs uppercase tracking-[0.14em] text-muted">Unternehmen</div>
            <ul className="mt-3 space-y-2 text-sm text-ink">
              <li><Link href="/blog" className="hover:text-muted">Blog</Link></li>
              <li><a href="/ueber-uns" className="hover:text-muted">Über uns</a></li>
              <li><button type="button" data-contact="" className="hover:text-muted">Kontakt</button></li>
            </ul>
          </div>
          <div>
            <div className="text-xs uppercase tracking-[0.14em] text-muted">Rechtliches</div>
            <ul className="mt-3 space-y-2 text-sm text-ink">
              <li><a href="/agb" className="hover:text-muted">AGB</a></li>
              <li><a href="/datenschutz" className="hover:text-muted">Datenschutz</a></li>
              <li><a href="/impressum" className="hover:text-muted">Impressum</a></li>
              <li><a href="/avv" className="hover:text-muted">AVV (DSGVO)</a></li>
            </ul>
          </div>
        </div>
        <div className="border-t border-line">
          <div className="max-w-[1180px] mx-auto px-6 md:px-8 py-5 text-xs text-muted flex flex-col md:flex-row gap-2 md:gap-6">
            <div>© 2026 Infetch</div>
            <button type="button" data-contact="" className="hover:text-ink transition-colors">hallo@infetch.de</button>
          </div>
        </div>
      </footer>
      <ContactController />
    </div>
  );
}
