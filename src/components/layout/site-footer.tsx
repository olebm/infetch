import Image from "next/image";
import Link from "next/link";

/**
 * Gemeinsamer Footer für alle Shells (AppShell, PublicShell).
 * Einheitliches Erscheinungsbild auf App- und Rechtsseiten.
 */
export function SiteFooter() {
  return (
    <footer className="mt-12 border-t border-line">
      <div className="mx-auto flex max-w-[1180px] flex-col gap-3 px-4 py-6 text-xs text-muted md:flex-row md:items-center md:gap-6 md:px-8">
        <div className="flex items-center gap-2">
          <Image
            src="/images/brand/infetch-logo.svg"
            alt="Infetch"
            width={64}
            height={20}
            className="h-5 w-auto opacity-80"
            draggable={false}
          />
          <span>© 2026 Infetch</span>
        </div>
        <nav
          className="flex flex-wrap items-center gap-x-5 gap-y-1 md:ml-auto"
          aria-label="Footer-Navigation"
        >
          <Link href="/agb" className="hover:text-ink">
            AGB
          </Link>
          <Link href="/datenschutz" className="hover:text-ink">
            Datenschutz
          </Link>
          <Link href="/impressum" className="hover:text-ink">
            Impressum
          </Link>
          <Link href="/avv" className="hover:text-ink">
            AVV (DSGVO)
          </Link>
        </nav>
      </div>
    </footer>
  );
}
