"use client";

import { useState } from "react";
import Link from "next/link";

const LINKS = [
  { href: "#how",        label: "Wie es funktioniert" },
  { href: "#features",   label: "Funktionen"           },
  { href: "#sicherheit", label: "Sicherheit"           },
  { href: "#preise",     label: "Preise"               },
  { href: "#faq",        label: "FAQ"                  },
];

export function MobileNav() {
  const [open, setOpen] = useState(false);

  return (
    <>
      {/* Hamburger button */}
      <button
        type="button"
        className="p-2 -mr-1 text-ink"
        aria-label={open ? "Menü schließen" : "Menü öffnen"}
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
      >
        {open ? (
          <svg width="20" height="20" viewBox="0 0 20 20" fill="none" aria-hidden>
            <path d="M4 4l12 12M16 4L4 16" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
          </svg>
        ) : (
          <svg width="20" height="20" viewBox="0 0 20 20" fill="none" aria-hidden>
            <path d="M3 6h14M3 10h14M3 14h14" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
          </svg>
        )}
      </button>

      {/* Dropdown panel */}
      {open && (
        <div className="md:hidden absolute top-16 left-0 right-0 z-50 bg-white border-b border-line shadow-pop">
          <nav className="max-w-[1180px] mx-auto px-6 py-5 flex flex-col gap-1">
            {LINKS.map(({ href, label }) => (
              <a
                key={href}
                href={href}
                className="py-2.5 text-sm text-ink hover:text-muted transition-colors"
                onClick={() => setOpen(false)}
              >
                {label}
              </a>
            ))}
            <div className="mt-3 pt-3 border-t border-line">
              <Link
                href="https://app.infetch.de/login"
                className="inline-flex h-10 w-full items-center justify-center rounded bg-ink text-white text-sm font-medium hover:opacity-90"
                onClick={() => setOpen(false)}
              >
                Kostenlos starten
              </Link>
            </div>
          </nav>
        </div>
      )}
    </>
  );
}
