import Image from "next/image";
import "@/app/legal-prose.css";
import { SiteFooter } from "@/components/layout/site-footer";

/**
 * Minimal shell for public (non-authenticated) pages like legal, changelog, etc.
 * Header: logo → https://infetch.de  ·  Footer: copyright + legal links
 */
export function PublicShell({
  title,
  children,
}: {
  title: string;
  children?: React.ReactNode;
}) {
  return (
    <div className="flex min-h-screen flex-col bg-surface">
      {/* ── Header ────────────────────────────────────────────────────────── */}
      <header className="border-b border-line bg-white">
        <div className="mx-auto flex h-14 max-w-[900px] items-center px-6">
          <a href="https://infetch.de" aria-label="Infetch — Startseite">
            <Image
              src="/images/brand/infetch-logo.svg"
              alt="Infetch"
              width={108}
              height={34}
              className="h-9 w-auto select-none"
              priority
            />
          </a>
        </div>
      </header>

      {/* ── Content ───────────────────────────────────────────────────────── */}
      <main className="mx-auto w-full max-w-[900px] flex-1 px-6 py-16">
        <h1 className="font-display text-4xl text-ink [hyphens:auto]" lang="de">{title}</h1>
        {children && <div className="legal-prose mt-10 text-muted">{children}</div>}
        {!children && (
          <p className="mt-10 text-muted">
            Dieser Inhalt wird in Kürze veröffentlicht.
          </p>
        )}
      </main>

      {/* ── Footer ────────────────────────────────────────────────────────── */}
      <SiteFooter />
    </div>
  );
}
