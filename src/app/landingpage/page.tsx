"use client";

import { useEffect, useState } from "react";
import Image from "next/image";
import Link from "next/link";
import { ContactModal } from "@/components/ui/contact-modal";
import { VendorLogo } from "@/components/ui/vendor-logo";

// ─── Tooltip helper ───────────────────────────────────────────────────────────

function Tip({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <span className="relative group/tip inline-flex">
      {children}
      <span className="pointer-events-none absolute bottom-full left-1/2 -translate-x-1/2 mb-2
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
  const [contactOpen, setContactOpen] = useState(false);

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
            <Image src="/infetch-logo.svg" alt="Infetch" width={90} height={28} className="h-9 w-auto" priority />
          </Link>
          <nav className="hidden md:flex items-center gap-6 ml-6 text-sm text-muted">
            <a href="#how" className="hover:text-ink">Wie es funktioniert</a>
            <a href="#features" className="hover:text-ink">Funktionen</a>
            <a href="#sicherheit" className="hover:text-ink">Sicherheit</a>
            <a href="#preise" className="hover:text-ink">Preise</a>
            <a href="#faq" className="hover:text-ink">FAQ</a>
          </nav>
          <div className="flex items-center gap-2 ml-auto">
            <Link href="https://app.infetch.de/login" className="hidden md:inline-flex h-9 px-4 text-sm items-center rounded border border-line text-ink hover:bg-surface transition-colors">
              Kostenlos starten
            </Link>
            <Link href="https://app.infetch.de/login" className="inline-flex h-9 px-4 text-sm font-medium items-center rounded bg-ink text-white hover:opacity-90">
              Anmelden
            </Link>
          </div>
        </div>
      </header>

      <main>
      {/* ================================================================== */}
      {/* HERO                                                                */}
      {/* ================================================================== */}
      <section className="relative">
        <div className="max-w-[1180px] mx-auto pl-6 md:pl-8 pr-6 md:pr-8 lg:pr-0 pt-16 md:pt-24 pb-12 md:pb-20 grid lg:grid-cols-[1fr_1.1fr] gap-12 lg:gap-14 items-center">

          <div>
            <Tip label="Scannt dein Postfach alle 5 Minuten nach neuen Rechnungen">
              <div className="inline-flex items-center gap-2 text-xs text-ok cursor-default">
                <span className="w-1.5 h-1.5 rounded-full bg-ok pulse-dot"></span>
                Auto-Pilot · scannt jetzt
              </div>
            </Tip>
            <h1 className="mt-5 font-display text-5xl md:text-6xl lg:text-7xl text-ink leading-[1.02] max-w-[18ch]">
              Rechnungen, die sich <span className="accent">selbst</span> weiterleiten.
            </h1>
            <p className="mt-6 text-lg text-muted max-w-[42ch] leading-relaxed">
              Infetch liest dein Postfach mit, erkennt jede Rechnung und schickt sie an deine Buchhaltung — automatisch.
            </p>
            <div className="mt-8 flex flex-wrap items-center gap-3">
              <Link href="https://app.infetch.de/login" className="inline-flex h-11 px-5 rounded items-center bg-ink text-white text-sm font-medium hover:opacity-90">
                Kostenlos starten
              </Link>
              <a href="#how" className="inline-flex h-11 px-4 rounded items-center text-sm text-ink ul-link">
                Wie es funktioniert
              </a>
            </div>
            <div className="mt-8 flex items-center gap-6 text-xs text-muted">
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

          {/* HERO VISUAL: animated inbox */}
          <div>
            <div className="mock-window shadow-lift">
              <div className="px-5 pt-5 pb-2 flex items-baseline justify-between">
                <div className="font-display text-2xl text-ink">Heute</div>
                <div className="text-[11px] text-muted stat-num">14. Mai 2026 · 14:32</div>
              </div>

              <ul className="px-2 pb-3">
                {[
                  { domain: "hetzner.com", label: "Hetzner Online · Rechnung 2026-05",           meta: "09:14 · 27,55 €",  animated: false },
                  { domain: "adobe.com",   label: "Adobe Systems · Creative Cloud",               meta: "11:02 · 77,99 €",  animated: false },
                  { domain: "telekom.de",  label: "Telekom Deutschland · Festnetz & Internet",    meta: "jetzt · 44,95 €",  animated: true  },
                  { domain: "canva.com",   label: "Canva Pty Ltd · Pro Plan",                     meta: "gestern · 14,99 €", animated: false },
                ].map(({ domain, label, meta, animated }, i, arr) => (
                  <li key={domain}
                    className={`${animated ? "anim-row" : "row-hover"} px-3 py-3 flex items-center gap-4 ${i < arr.length - 1 ? "border-b border-line" : ""}`}>
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={`https://www.google.com/s2/favicons?domain=${domain}&sz=72`}
                      alt={domain}
                      width={36} height={36}
                      referrerPolicy="no-referrer"
                      className="rounded-full shrink-0 object-contain"
                    />
                    <div className="flex-1 min-w-0">
                      <div className="text-sm font-medium text-ink truncate">{label}</div>
                      <div className="mt-0.5 text-xs text-muted stat-num">{meta}</div>
                    </div>
                    {animated ? (
                      <div className="relative" style={{ minWidth: "72px", height: "20px" }}>
                        <span className="anim-badge absolute inset-0 inline-flex items-center justify-end gap-1.5 whitespace-nowrap">
                          <span className="inline-block h-1.5 w-1.5 shrink-0 rounded-full bg-warn-vivid"></span>
                          <span className="text-xs text-muted">erkannt</span>
                        </span>
                        <span className="anim-sent absolute inset-0 inline-flex items-center justify-end gap-1.5 whitespace-nowrap">
                          <span className="inline-block h-1.5 w-1.5 shrink-0 rounded-full bg-ok"></span>
                          <span className="text-xs text-muted">verschickt</span>
                        </span>
                      </div>
                    ) : (
                      <span className="inline-flex items-center gap-1.5">
                        <span className="inline-block h-1.5 w-1.5 shrink-0 rounded-full bg-ok"></span>
                        <span className="text-xs text-muted">verschickt</span>
                      </span>
                    )}
                  </li>
                ))}
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
            Erkennt Rechnungen von
          </div>
          <div className="flex flex-wrap items-center justify-center gap-x-10 gap-y-6 md:gap-x-16">
            {[
              { domain: "adobe.com",      alt: "Adobe"      },
              { domain: "amazon.de",      alt: "Amazon"     },
              { domain: "canva.com",      alt: "Canva"      },
              { domain: "figma.com",      alt: "Figma"      },
              { domain: "hetzner.com",    alt: "Hetzner"    },
              { domain: "microsoft.com",  alt: "Microsoft"  },
              { domain: "telekom.de",     alt: "Telekom"    },
            ].map(({ domain, alt }) => (
              <Tip key={domain} label={alt}>
                <div className="h-7 flex items-center cursor-default">
                  <img
                    src={`https://www.google.com/s2/favicons?domain=${domain}&sz=128`}
                    alt={alt}
                    width={28}
                    height={28}
                    referrerPolicy="no-referrer"
                    className="h-7 w-auto object-contain opacity-80"
                  />
                </div>
              </Tip>
            ))}
          </div>
          <div className="mt-6 text-center text-xs text-muted">
            Und alle weiteren — die KI erkennt jeden Anbieter automatisch.
          </div>
        </div>
      </section>

      {/* ================================================================== */}
      {/* PROBLEM FRAME                                                       */}
      {/* ================================================================== */}
      <section className="py-14 md:py-20">
        <div className="max-w-[860px] mx-auto px-6 md:px-8 text-center reveal">
          <p className="font-display text-2xl md:text-3xl text-ink leading-snug max-w-2xl mx-auto">
            Jede Rechnung kommt von einer anderen Adresse, in einem anderen Format, in einem anderen Postfach.
          </p>
          <p className="mt-5 text-muted leading-relaxed max-w-xl mx-auto">
            Selbstständige und kleine Teams verbringen Stunden damit, Belege zusammenzusuchen — manuell, jeden Monat, aufs Neue.
            Infetch macht das automatisch.
          </p>
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
                IMAP — Gmail, Outlook, iCloud und mehr. Kein Passwort wird bei uns gespeichert.
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
              <p className="mt-2 text-muted leading-relaxed min-h-[3.5rem]">
                KI liest Anbieter, Betrag, Steuersatz. Unsichere Fälle fragen nach.{" "}
                <span className="text-ink/70">Nur Anhänge — nie der Mail-Text.</span>
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
              <p className="mt-2 text-muted leading-relaxed min-h-[3.5rem]">
                PDF geht an deinen Buchhaltungs-Empfänger. Du machst nichts.{" "}
                <span className="text-ink/70">Du siehst jeden Schritt im Audit-Log.</span>
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
                Ein Klick auf „privat" — Anbieter oder Mail landet nie in der Buchhaltung.
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
                    { domain: "telekom.de", name: "Telekom Mobilfunk",  expect: "erwartet 02. Mai · 59,90 €", label: "3 Tage spät",   cls: "text-warn" },
                    { domain: "figma.com",  name: "Figma Inc.",          expect: "erwartet 12. Mai · 45,00 €", label: "heute fällig",  cls: "text-muted" },
                    { domain: "zoom.us",    name: "Zoom Video Comm.",    expect: "erwartet 14. Mai · 13,99 €", label: "in 2 Tagen",   cls: "text-muted" },
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
                { label: "Standort",           value: "EU · Frankfurt",    detail: "Hetzner · ISO 27001"          },
                { label: "Verschlüsselung",    value: "AES-256",           detail: "at rest · in transit"         },
                { label: "DSGVO",              value: "AVV inklusive",     detail: "Art. 28 DSGVO"                },
                { label: "Postfach-Zugriff",   value: "OAuth · IMAP",      detail: "jederzeit widerrufbar"        },
                { label: "Datenhaltung",       value: "nur Belege",        detail: "Mail-Body wird verworfen"     },
                { label: "Audit-Log",          value: "vollständig",       detail: "jede Aktion nachvollziehbar"  },
                { label: "KI-Training",        value: "keine",             detail: "Deine Daten trainieren nichts" },
              ].map(({ label, value, detail }) => (
                <div key={label}>
                  <dt className="text-xs text-muted">{label}</dt>
                  <dd className="mt-1 font-display text-2xl text-ink">{value}</dd>
                  <dd className="text-xs text-muted mt-1">{detail}</dd>
                </div>
              ))}
            </dl>
            <div className="mt-8">
              <Link href="/datenschutz" className="text-sm ul-link text-muted hover:text-ink">
                Datenschutzerklärung lesen
              </Link>
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
                  { domain: "outlook.com", label: "Microsoft 365"     },
                  { domain: "icloud.com",  label: "Apple iCloud"      },
                  { domain: null,          label: "IMAP (universal)"  },
                ].map(({ domain, label }) => (
                  <li key={label} className="relative group/tip h-12 w-12 logo-tile rounded-full flex items-center justify-center cursor-default overflow-hidden">
                    {domain
                      ? <VendorLogo domain={domain} name={label} size={48} />
                      : <span className="text-sm text-muted font-medium">@</span>}
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
                  { domain: "kontist.com",    label: "Kontist"             },
                  { domain: "sevdesk.de",     label: "sevdesk"             },
                  { domain: "accountable.eu", label: "Accountable"         },
                  { domain: "lexoffice.de",   label: "lexoffice"           },
                  { domain: "sage.com",       label: "Sage"                },
                  { domain: "candis.io",      label: "Candis"              },
                  { domain: null,             label: "Beliebige E-Mail"    },
                ].map(({ domain, label }) => (
                  <li key={label} className="relative group/tip h-12 w-12 logo-tile rounded-full flex items-center justify-center cursor-default overflow-hidden">
                    {domain
                      ? <VendorLogo domain={domain} name={label} size={48} />
                      : <span className="text-sm text-muted font-medium">@</span>}
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
              <div className="mt-4 font-display text-5xl text-ink stat-num">19 €</div>
              <div className="text-xs text-muted mt-1">/ Monat · zzgl. USt</div>
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
            <button type="button" onClick={() => setContactOpen(true)} className="ul-link">Sprich mit uns.</button>
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
              <button type="button" onClick={() => setContactOpen(true)} className="ul-link">hallo@infetch.de</button>
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
            Du suchst seit Jahren nach Belegen.<br />
            <span className="text-white/50">Ab Montag nicht mehr.</span>
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
            </ul>
          </div>
          <div>
            <div className="text-xs uppercase tracking-[0.14em] text-muted">Unternehmen</div>
            <ul className="mt-3 space-y-2 text-sm text-ink">
              <li><button type="button" onClick={() => setContactOpen(true)} className="hover:text-muted">Kontakt</button></li>
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
            <button type="button" onClick={() => setContactOpen(true)} className="hover:text-ink transition-colors">hallo@infetch.de</button>
            <div className="md:ml-auto">Alle Markennamen und Logos sind Eigentum der jeweiligen Inhaber.</div>
          </div>
        </div>
      </footer>
      <ContactModal open={contactOpen} onClose={() => setContactOpen(false)} />
    </>
  );
}
