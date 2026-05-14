"use client";

import { useEffect } from "react";
import Image from "next/image";
import Link from "next/link";

// ─── Logo tile helper ─────────────────────────────────────────────────────────

function LogoImg({ domain, alt }: { domain: string; alt: string }) {
  const initial = (alt || domain)[0]?.toUpperCase() ?? "?";
  return (
    <img
      src={`https://www.google.com/s2/favicons?domain=${domain}&sz=128`}
      alt={alt}
      referrerPolicy="no-referrer"
      style={{ width: "70%", height: "70%", objectFit: "contain" }}
      onError={(e) => {
        const img = e.currentTarget;
        const tile = img.parentElement;
        if (tile) {
          tile.innerHTML = `<span style="font-size:12px;color:#7a7a76;font-weight:500">${initial}</span>`;
        }
      }}
    />
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function LandingPage() {
  // Reveal on scroll
  useEffect(() => {
    const io = new IntersectionObserver(
      (entries) => entries.forEach((e) => { if (e.isIntersecting) e.target.classList.add("in"); }),
      { threshold: 0.15 },
    );
    document.querySelectorAll(".reveal").forEach((el) => io.observe(el));
    return () => io.disconnect();
  }, []);

  return (
    <>
      {/* ================================================================== */}
      {/* NAV                                                                 */}
      {/* ================================================================== */}
      <header className="sticky top-0 z-40 nav-blur border-b border-line">
        <div className="max-w-[1180px] mx-auto px-6 md:px-8 h-16 flex items-center gap-6">
          <Link href="/" className="flex items-center" aria-label="Infetch">
            <Image src="/infetch-logo.svg" alt="Infetch" width={90} height={28} className="h-9 w-auto" />
          </Link>
          <nav className="hidden md:flex items-center gap-6 ml-6 text-sm text-muted">
            <a href="#how" className="hover:text-ink">Wie es funktioniert</a>
            <a href="#features" className="hover:text-ink">Funktionen</a>
            <a href="#sicherheit" className="hover:text-ink">Sicherheit</a>
            <a href="#preise" className="hover:text-ink">Preise</a>
            <a href="#faq" className="hover:text-ink">FAQ</a>
          </nav>
          <div className="flex items-center gap-2 ml-auto">
<Link href="/" className="inline-flex h-9 px-4 text-sm font-medium items-center rounded bg-ink text-white hover:opacity-90">
              Anmelden
            </Link>
          </div>
        </div>
      </header>

      {/* ================================================================== */}
      {/* HERO                                                                */}
      {/* ================================================================== */}
      <section className="relative">
        <div className="max-w-[1180px] mx-auto px-6 md:px-8 pt-16 md:pt-24 pb-12 md:pb-20 grid lg:grid-cols-[1.05fr_1fr] gap-12 lg:gap-16 items-center">

          <div className="reveal">
            <div className="inline-flex items-center gap-2 text-xs text-ok">
              <span className="w-1.5 h-1.5 rounded-full bg-ok pulse-dot"></span>
              Auto-Pilot · scannt jetzt
            </div>
            <h1 className="mt-5 font-display text-5xl md:text-6xl lg:text-7xl text-ink leading-[1.02] max-w-[18ch]">
              Rechnungen, die sich <span className="accent">selbst</span> weiterleiten.
            </h1>
            <p className="mt-6 text-lg text-muted max-w-[42ch] leading-relaxed">
              Infetch liest dein Postfach mit, erkennt jede Rechnung und schickt sie an deine Buchhaltung — automatisch.
            </p>
            <div className="mt-8 flex flex-wrap items-center gap-3">
              <Link href="/" className="inline-flex h-11 px-5 rounded items-center bg-ink text-white text-sm font-medium hover:opacity-90">
                Kostenlos testen
              </Link>
              <a href="#how" className="inline-flex h-11 px-4 rounded items-center text-sm text-ink ul-link">
                Wie es funktioniert
              </a>
            </div>
            <div className="mt-8 flex items-center gap-6 text-xs text-muted">
              <div className="flex items-center gap-2"><span className="text-ink stat-num">99,1 %</span> Klassifikation korrekt</div>
              <div className="flex items-center gap-2"><span className="text-ink stat-num">≈ 4 Min</span> Einrichtung</div>
              <div className="flex items-center gap-2"><span className="text-ink stat-num">DSGVO</span> · EU-Server</div>
            </div>
          </div>

          {/* HERO VISUAL: animated inbox */}
          <div className="reveal">
            <div className="mock-window shadow-lift">
              <div className="px-5 pt-5 pb-2 flex items-baseline justify-between">
                <div className="font-display text-2xl text-ink">Heute</div>
                <div className="text-[11px] text-muted stat-num">14. Mai 2026 · 14:32</div>
              </div>

              <ul className="px-2 pb-3">
                <li className="row-hover px-3 py-3 flex items-center gap-3 border-b border-line">
                  <div className="h-8 w-8 logo-tile rounded"><LogoImg domain="hetzner.com" alt="Hetzner" /></div>
                  <div className="flex-1 min-w-0">
                    <div className="text-sm text-ink truncate">Hetzner Online · Rechnung 2026-05</div>
                    <div className="text-xs text-muted stat-num">09:14 · 27,55 €</div>
                  </div>
                  <span className="inline-flex items-center gap-1.5 text-xs text-ok">
                    <span className="w-1.5 h-1.5 rounded-full bg-ok"></span>versendet
                  </span>
                </li>

                <li className="row-hover px-3 py-3 flex items-center gap-3 border-b border-line">
                  <div className="h-8 w-8 logo-tile rounded"><LogoImg domain="adobe.com" alt="Adobe" /></div>
                  <div className="flex-1 min-w-0">
                    <div className="text-sm text-ink truncate">Adobe Systems · Creative Cloud</div>
                    <div className="text-xs text-muted stat-num">11:02 · 71,98 €</div>
                  </div>
                  <span className="inline-flex items-center gap-1.5 text-xs text-ok">
                    <span className="w-1.5 h-1.5 rounded-full bg-ok"></span>versendet
                  </span>
                </li>

                {/* ANIMATED ROW */}
                <li className="px-3 py-3 flex items-center gap-3 border-b border-line anim-row">
                  <div className="h-8 w-8 logo-tile rounded"><LogoImg domain="stripe.com" alt="Stripe" /></div>
                  <div className="flex-1 min-w-0">
                    <div className="text-sm text-ink truncate">Stripe Payments UK · Invoice 49 210</div>
                    <div className="text-xs text-muted stat-num">jetzt · 146,53 €</div>
                  </div>
                  <div className="relative" style={{ minWidth: "72px", height: "20px" }}>
                    <span className="anim-badge absolute inset-0 inline-flex items-center gap-1.5 text-xs text-ink whitespace-nowrap">
                      <span className="w-1.5 h-1.5 rounded-full bg-warn shrink-0"></span>erkannt
                    </span>
                    <span className="anim-sent absolute inset-0 inline-flex items-center gap-1.5 text-xs text-ok whitespace-nowrap">
                      <span className="w-1.5 h-1.5 rounded-full bg-ok shrink-0"></span>versendet
                    </span>
                  </div>
                </li>

                <li className="row-hover px-3 py-3 flex items-center gap-3">
                  <div className="h-8 w-8 logo-tile rounded"><LogoImg domain="vercel.com" alt="Vercel" /></div>
                  <div className="flex-1 min-w-0">
                    <div className="text-sm text-ink truncate">Vercel Inc. · Pro Subscription</div>
                    <div className="text-xs text-muted stat-num">gestern · 19,42 €</div>
                  </div>
                  <span className="inline-flex items-center gap-1.5 text-xs text-ok">
                    <span className="w-1.5 h-1.5 rounded-full bg-ok"></span>versendet
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
      {/* LOGO STRIP                                                          */}
      {/* ================================================================== */}
      <section className="border-y border-line bg-paper">
        <div className="max-w-[1180px] mx-auto px-6 md:px-8 py-10">
          <div className="text-[11px] uppercase tracking-[0.14em] text-muted text-center mb-7">
            Versteht Rechnungen von
          </div>
          <div className="flex flex-wrap items-center justify-center gap-x-10 gap-y-6 md:gap-x-16">
            {[
              { domain: "stripe.com",   alt: "Stripe"  },
              { domain: "adobe.com",    alt: "Adobe"   },
              { domain: "hetzner.com",  alt: "Hetzner" },
              { domain: "telekom.de",   alt: "Telekom" },
              { domain: "figma.com",    alt: "Figma"   },
              { domain: "github.com",   alt: "GitHub"  },
              { domain: "openai.com",   alt: "OpenAI"  },
            ].map(({ domain, alt }) => (
              <div key={domain} className="h-7 flex items-center">
                <img
                  src={`https://www.google.com/s2/favicons?domain=${domain}&sz=128`}
                  alt={alt}
                  referrerPolicy="no-referrer"
                  className="h-7 w-auto object-contain opacity-80"
                />
              </div>
            ))}
          </div>
          <div className="mt-6 text-center text-xs text-muted">
            &amp; <span className="text-ink stat-num">240+</span> weitere Anbieter —{" "}
            <a href="#" className="ul-link">vollständige Liste</a>
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
              In vier Minuten verbunden.<br />
              Danach läuft alles ohne dich.
            </h2>
          </div>

          <div className="mt-14 grid md:grid-cols-3 gap-x-10 gap-y-12 reveal">
            {/* step 1 */}
            <div className="flex flex-col">
              <div className="text-xs text-muted stat-num">01</div>
              <h3 className="mt-2 font-display text-2xl text-ink">Postfach verbinden</h3>
              <p className="mt-2 text-muted leading-relaxed min-h-[3.5rem]">
                Gmail, Outlook, IMAP. OAuth, kein Passwort bei uns.
              </p>
              <div className="mt-6 mock-window">
                <div className="px-4 py-3 border-b border-line flex items-center gap-2">
                  <div className="h-6 w-6 logo-tile rounded"><LogoImg domain="google.com" alt="Gmail" /></div>
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
              <p className="mt-2 text-muted leading-relaxed min-h-[3.5rem]">
                KI liest Anbieter, Betrag, Steuersatz. Unsichere Fälle fragen nach.
              </p>
              <div className="mt-6 mock-window">
                <div className="px-4 py-3 border-b border-line flex items-center gap-2">
                  <div className="h-6 w-6 logo-tile rounded"><LogoImg domain="adobe.com" alt="Adobe" /></div>
                  <div className="text-xs text-ink truncate">Adobe · Creative Cloud</div>
                  <span className="ml-auto text-[11px] text-ink stat-num">71,98 €</span>
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
              <p className="mt-2 text-muted leading-relaxed min-h-[3.5rem]">
                PDF geht an deinen Buchhaltungs-Empfänger. Du machst nichts.
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
                    { domain: "hetzner.com", name: "Hetzner Online",   count: "14 Rechnungen · monatlich", sum: "385,70 €" },
                    { domain: "stripe.com",  name: "Stripe Payments UK", count: "4 Rechnungen · monatlich",  sum: "586,12 €" },
                    { domain: "adobe.com",   name: "Adobe Systems",    count: "5 Rechnungen · monatlich",  sum: "359,90 €" },
                  ].map(({ domain, name, count, sum }) => (
                    <li key={domain} className="px-4 py-3 flex items-center gap-3 row-hover">
                      <div className="h-9 w-9 logo-tile rounded"><LogoImg domain={domain} alt={name} /></div>
                      <div className="flex-1 min-w-0">
                        <div className="text-sm text-ink">{name}</div>
                        <div className="text-[11px] text-muted stat-num">{count}</div>
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
                Ein Klick auf „privat" — Anbieter oder Mail landet nie in der Buchhaltung.
              </p>
              <div className="mt-6 mock-window">
                <div className="px-4 py-3 border-b border-line flex items-center gap-3">
                  <div className="h-9 w-9 logo-tile rounded"><LogoImg domain="spotify.com" alt="Spotify" /></div>
                  <div className="flex-1 min-w-0">
                    <div className="text-sm text-ink">Spotify · Premium Familie</div>
                    <div className="text-[11px] text-muted stat-num">spotify.com · 9,99 €</div>
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
                    { domain: "telekom.de", name: "Telekom Mobilfunk",  expect: "erwartet 02. Mai · 59,90 €", label: "3 Tage spät",   cls: "text-warn" },
                    { domain: "figma.com",  name: "Figma Inc.",          expect: "erwartet 12. Mai · 45,00 €", label: "heute fällig",  cls: "text-muted" },
                    { domain: "github.com", name: "GitHub Inc.",         expect: "erwartet 14. Mai · 21,00 €", label: "in 2 Tagen",   cls: "text-muted" },
                  ].map(({ domain, name, expect, label, cls }) => (
                    <li key={domain} className="px-4 py-3 flex items-center gap-3 row-hover">
                      <div className="h-9 w-9 logo-tile rounded"><LogoImg domain={domain} alt={name} /></div>
                      <div className="flex-1 min-w-0">
                        <div className="text-sm text-ink">{name}</div>
                        <div className="text-[11px] text-muted stat-num">{expect}</div>
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
                    { label: "Standard",  email: "belege@beispiel.de"       },
                    { label: "Sekundär",  email: "buchhaltung@beispiel.de"  },
                    { label: "Marketing", email: "marketing@studio.de"      },
                  ].map(({ label, email }) => (
                    <li key={label} className="px-4 py-3 flex items-center gap-3">
                      <div className="text-sm text-ink">{label}</div>
                      <div className="ml-auto text-xs text-muted font-mono truncate">{email}</div>
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
                Wir lesen nicht jede Mail. Wir filtern auf Rechnungsmerkmale.
                Alles, was wir speichern, liegt in Frankfurt. Verschlüsselt.
                Du kannst es jederzeit löschen.
              </p>
            </div>

            <dl className="grid grid-cols-2 gap-y-8 gap-x-8">
              {[
                { label: "Standort",         value: "EU · Frankfurt",    detail: "Hetzner · ISO 27001"          },
                { label: "Verschlüsselung",  value: "AES-256",           detail: "at rest · in transit"         },
                { label: "DSGVO",            value: "AVV inklusive",     detail: "Art. 28 DSGVO"                },
                { label: "Postfach-Zugriff", value: "OAuth · IMAP",      detail: "jederzeit widerrufbar"        },
                { label: "Datenhaltung",     value: "nur Belege",        detail: "Mail-Body wird verworfen"     },
                { label: "Audit-Log",        value: "vollständig",       detail: "jede Aktion nachvollziehbar"  },
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
      </section>

      {/* ================================================================== */}
      {/* INTEGRATIONEN                                                       */}
      {/* ================================================================== */}
      <section className="py-20 md:py-28 bg-paper border-y border-line">
        <div className="max-w-[1180px] mx-auto px-6 md:px-8">
          <div className="max-w-2xl">
            <div className="text-[11px] uppercase tracking-[0.14em] text-muted">Integrationen</div>
            <h2 className="mt-3 font-display text-4xl md:text-5xl text-ink leading-[1.05]">
              Spricht mit allem, was du schon hast.
            </h2>
          </div>

          <div className="mt-14 grid md:grid-cols-2 gap-12">
            <div>
              <h3 className="text-xs uppercase tracking-[0.14em] text-muted">Postfächer</h3>
              <ul className="mt-4 grid grid-cols-2 gap-3">
                {[
                  { domain: "google.com",  label: "Gmail · Workspace" },
                  { domain: "outlook.com", label: "Microsoft 365"     },
                  { domain: "icloud.com",  label: "Apple iCloud"      },
                  { domain: null,          label: "IMAP (universal)"  },
                ].map(({ domain, label }) => (
                  <li key={label} className="px-4 py-3 border border-line rounded text-sm text-ink flex items-center gap-3">
                    <span className="h-6 w-6 logo-tile rounded flex items-center justify-center">
                      {domain ? <LogoImg domain={domain} alt={label} /> : <span className="text-[10px] text-muted">@</span>}
                    </span>
                    <span>{label}</span>
                  </li>
                ))}
              </ul>
            </div>
            <div>
              <h3 className="text-xs uppercase tracking-[0.14em] text-muted">Empfänger · Buchhaltung</h3>
              <ul className="mt-4 grid grid-cols-2 gap-3">
                {[
                  { domain: "datev.de",       label: "DATEV Belegtransfer" },
                  { domain: "kontist.com",    label: "Kontist"             },
                  { domain: "sevdesk.de",     label: "sevdesk"             },
                  { domain: "accountable.eu", label: "Accountable"         },
                  { domain: "lexoffice.de",   label: "lexoffice"           },
                  { domain: "sage.com",       label: "Sage"                },
                  { domain: "candis.io",      label: "Candis"              },
                  { domain: null,             label: "Beliebige E-Mail"    },
                ].map(({ domain, label }) => (
                  <li key={label} className="px-4 py-3 border border-line rounded text-sm text-ink flex items-center gap-3">
                    <span className="h-6 w-6 logo-tile rounded flex items-center justify-center">
                      {domain ? <LogoImg domain={domain} alt={label} /> : <span className="text-[10px] text-muted">@</span>}
                    </span>
                    <span>{label}</span>
                  </li>
                ))}
              </ul>
              <div className="mt-3 text-xs text-muted">
                Dein Tool fehlt? Per E-Mail funktioniert immer.
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ================================================================== */}
      {/* TESTIMONIALS                                                        */}
      {/* ================================================================== */}
      <section className="py-20 md:py-28">
        <div className="max-w-[1180px] mx-auto px-6 md:px-8">
          <div className="text-[11px] uppercase tracking-[0.14em] text-muted">Aus der Praxis</div>
          <h2 className="mt-3 font-display text-4xl md:text-5xl text-ink leading-[1.05] max-w-2xl">
            Drei Stunden im Monat. Weniger.
          </h2>

          <div className="mt-14 grid md:grid-cols-3 gap-8 md:gap-10">
            {[
              {
                quote: `„Ich habe sieben Monate lang jede Rechnung von Hand an die Buchhaltung weitergeleitet. Infetch macht das in zwei Minuten Setup — und seitdem habe ich keinen Beleg mehr vergessen."`,
                initials: "LB",
                name: "Lena B.",
                role: "Freelance UX · Berlin",
              },
              {
                quote: `„Was mich überzeugt hat: der Fehlt-Tab. Letzten Monat hat Telekom drei Tage später geschickt, ich hatte es schon vergessen — Infetch nicht."`,
                initials: "JK",
                name: "Jan K.",
                role: "Geschäftsführer · 14 Mitarbeitende",
              },
              {
                quote: `„Endlich eine App, die nicht laut wird. Sie macht den Job, ich werde nicht abgelenkt."`,
                initials: "SM",
                name: "Sophie M.",
                role: "Steuerberaterin · Hamburg",
              },
            ].map(({ quote, initials, name, role }) => (
              <figure key={initials}>
                <blockquote className="font-display text-xl text-ink leading-[1.4]">
                  {quote}
                </blockquote>
                <figcaption className="mt-4 flex items-center gap-3">
                  <div className="h-9 w-9 rounded-full bg-surface flex items-center justify-center text-xs text-muted">
                    {initials}
                  </div>
                  <div>
                    <div className="text-sm text-ink">{name}</div>
                    <div className="text-xs text-muted">{role}</div>
                  </div>
                </figcaption>
              </figure>
            ))}
          </div>
        </div>
      </section>

      {/* ================================================================== */}
      {/* PREISE                                                              */}
      {/* ================================================================== */}
      <section id="preise" className="py-20 md:py-28 bg-paper border-y border-line">
        <div className="max-w-[1180px] mx-auto px-6 md:px-8">
          <div className="max-w-2xl">
            <div className="text-[11px] uppercase tracking-[0.14em] text-muted">Preise</div>
            <h2 className="mt-3 font-display text-4xl md:text-5xl text-ink leading-[1.05]">
              Zwei Tarife. Kein Kleingedrucktes.
            </h2>
            <p className="mt-5 text-muted leading-relaxed">
              Kostenlos starten. Kein Kreditkarte. Monatlich kündbar.
            </p>
          </div>

          <div className="mt-14 grid md:grid-cols-2 gap-6 max-w-2xl">
            {/* Plan: Solo */}
            <div className="border border-line rounded-lg p-6 bg-white flex flex-col">
              <div className="text-sm text-muted">Solo</div>
              <div className="mt-3 font-display text-4xl text-ink stat-num">0 €</div>
              <div className="text-xs text-muted">/ kostenlos</div>
              <p className="mt-4 text-sm text-muted leading-relaxed">
                Für Freelancer und kleine Selbstständige.
              </p>
              <ul className="mt-5 space-y-2 text-sm text-ink flex-1">
                <li>· 1 Postfach (IMAP)</li>
                <li>· Auto-Pilot aktiv</li>
                <li>· 1 Empfänger</li>
                <li>· E-Mail-Support</li>
              </ul>
              <Link href="/login" className="mt-6 inline-flex h-10 px-4 items-center justify-center rounded border border-line text-sm text-ink hover:bg-surface">
                Kostenlos starten
              </Link>
            </div>

            {/* Plan: Pro (highlighted) */}
            <div className="border-2 border-ink rounded-lg p-6 bg-white flex flex-col relative">
              <div className="absolute -top-3 left-6 inline-flex items-center gap-1 px-2 py-0.5 rounded bg-ink text-white text-[10px] uppercase tracking-[0.14em]">
                empfohlen
              </div>
              <div className="text-sm text-muted">Pro</div>
              <div className="mt-3 font-display text-4xl text-ink stat-num">9 €</div>
              <div className="text-xs text-muted">/ Monat · zzgl. USt</div>
              <p className="mt-4 text-sm text-muted leading-relaxed">
                Alles inklusive — für alle, die auf nichts verzichten wollen.
              </p>
              <ul className="mt-5 space-y-2 text-sm text-ink flex-1">
                <li>· Mehrere Postfächer</li>
                <li>· Mehrere Empfänger</li>
                <li>· Anbieter-Übersicht</li>
                <li>· Fehlt-Erkennung</li>
                <li>· Prioritäts-Support</li>
              </ul>
              <Link href="/login" className="mt-6 inline-flex h-10 px-4 items-center justify-center rounded bg-ink text-white text-sm font-medium hover:opacity-90">
                Kostenlos starten
              </Link>
            </div>
          </div>

          <div className="mt-8 text-xs text-muted">
            Besondere Anforderungen?{" "}
            <a href="mailto:hi@infetch.de" className="ul-link">Sprich mit uns.</a>
          </div>
        </div>
      </section>

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
              <a href="mailto:hi@infetch.de" className="ul-link">hi@infetch.de</a>
            </p>
          </div>

          <div className="divide-y divide-line border-t border-b border-line">
            {[
              {
                q: "Liest Infetch wirklich alle meine Mails?",
                a: "Nein. Wir filtern auf der Postfach-Seite auf Rechnungsmerkmale (Absender-Muster, PDF-Anhang, Stichwörter). Privatkorrespondenz erreicht unsere Server nicht.",
              },
              {
                q: "Was passiert, wenn die KI sich irrt?",
                a: "Unsichere Fälle gehen nicht raus — sie landen im Posteingang und warten auf dein OK. Du korrigierst einmal, der Agent lernt.",
              },
              {
                q: "Wer sieht meine Rechnungen?",
                a: "Nur du und die Empfänger, die du selbst hinterlegst. Unsere Mitarbeitenden haben keinen Zugriff auf Belegdaten, außer du erteilst einen ausdrücklichen Support-Konsens.",
              },
              {
                q: "Brauche ich technisches Wissen?",
                a: "Nein. Postfach verbinden, Empfänger eintragen, fertig. Vier Minuten. Wir testen alles für dich, bevor es live geht.",
              },
              {
                q: "Kann ich Anbieter ausschließen?",
                a: "Ja, pro Mail oder pro Domain. Spotify, Netflix oder die private Stromabrechnung kommen nie an die Buchhaltung.",
              },
              {
                q: "Wie kündige ich?",
                a: "Monatlich, in den Einstellungen, ein Klick. Deine Daten werden auf Wunsch sofort gelöscht.",
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

      {/* ================================================================== */}
      {/* FOOTER CTA                                                          */}
      {/* ================================================================== */}
      <section className="bg-ink text-white py-20 md:py-28">
        <div className="max-w-[1180px] mx-auto px-6 md:px-8 text-center">
          <div className="text-[11px] uppercase tracking-[0.14em] text-white/50">14 Tage kostenlos</div>
          <h2 className="mt-3 font-display text-5xl md:text-6xl leading-[1.02] max-w-3xl mx-auto text-white">
            Du suchst seit Jahren nach Belegen.<br />
            <span className="text-white/50">Ab Montag nicht mehr.</span>
          </h2>
          <div className="mt-10 flex flex-wrap justify-center items-center gap-4">
            <Link href="/" className="inline-flex h-12 px-6 items-center rounded bg-white text-ink text-sm font-medium hover:opacity-90">
              Kostenlos testen
            </Link>
            <a href="#" className="inline-flex h-12 px-4 items-center text-sm text-white/70 hover:text-white">
              Demo ansehen ›
            </a>
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
            <Image src="/infetch-logo.svg" alt="Infetch" width={90} height={28} className="h-9 w-auto opacity-90" />
            <p className="mt-4 text-sm text-muted leading-relaxed max-w-xs">
              Rechnungen, die sich selbst weiterleiten. Made in Hamburg.
            </p>
          </div>
          <div>
            <div className="text-xs uppercase tracking-[0.14em] text-muted">Produkt</div>
            <ul className="mt-3 space-y-2 text-sm text-ink">
              <li><a href="#how" className="hover:text-muted">Wie es funktioniert</a></li>
              <li><a href="#features" className="hover:text-muted">Funktionen</a></li>
              <li><a href="#preise" className="hover:text-muted">Preise</a></li>
              <li><a href="/changelog" className="hover:text-muted">Changelog</a></li>
            </ul>
          </div>
          <div>
            <div className="text-xs uppercase tracking-[0.14em] text-muted">Unternehmen</div>
            <ul className="mt-3 space-y-2 text-sm text-ink">
              <li><a href="/ueber-uns" className="hover:text-muted">Über uns</a></li>
              <li><a href="mailto:hi@infetch.de" className="hover:text-muted">Kontakt</a></li>
              <li><a href="https://status.infetch.de" className="hover:text-muted" target="_blank" rel="noopener">Status</a></li>
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
            <div>© 2026 Infetch GmbH</div>
            <div className="md:ml-auto">hi@infetch.de</div>
          </div>
        </div>
      </footer>
    </>
  );
}
