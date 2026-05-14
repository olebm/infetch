import Image from "next/image";
import Link from "next/link";

/**
 * Minimal shell for public (non-authenticated) pages like legal, changelog, etc.
 * Header: logo → /landingpage  ·  Footer: copyright + legal links
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
          <Link href="/landingpage" aria-label="Infetch — Startseite">
            <Image
              src="/infetch-logo.svg"
              alt="Infetch"
              width={108}
              height={34}
              className="h-9 w-auto select-none"
              priority
            />
          </Link>
        </div>
      </header>

      {/* ── Content ───────────────────────────────────────────────────────── */}
      <main className="mx-auto w-full max-w-[900px] flex-1 px-6 py-16">
        <h1 className="font-display text-4xl text-ink">{title}</h1>
        {children && <div className="mt-10 text-muted">{children}</div>}
        {!children && (
          <p className="mt-10 text-muted">
            Dieser Inhalt wird in Kürze veröffentlicht.
          </p>
        )}
      </main>

      {/* ── Footer ────────────────────────────────────────────────────────── */}
      <footer className="border-t border-line">
        <div className="mx-auto flex max-w-[900px] flex-wrap gap-4 px-6 py-6 text-xs text-muted">
          <span>© 2026 Infetch GmbH</span>
          <Link href="/impressum" className="hover:text-ink">Impressum</Link>
          <Link href="/datenschutz" className="hover:text-ink">Datenschutz</Link>
          <Link href="/agb" className="hover:text-ink">AGB</Link>
          <Link href="/avv" className="hover:text-ink">AVV (DSGVO)</Link>
        </div>
      </footer>
    </div>
  );
}
