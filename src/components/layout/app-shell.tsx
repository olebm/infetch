import Image from "next/image";
import Link from "next/link";
import { TopBar } from "@/components/layout/top-bar";
import { SupportFooterLink } from "@/components/support/support-fab";
import { getCurrentAuth } from "@/lib/auth/current";
import { getInvoiceStatusCounts } from "@/lib/db/queries";
import { appConfig } from "@/lib/config/env";

export async function AppShell({ children }: { children: React.ReactNode }) {
  const auth = await getCurrentAuth();

  // Unauthentifizierte Routen (z.B. /login, /onboarding) zeigen keine Shell.
  if (!auth) {
    return <>{children}</>;
  }

  const statusCountsRaw = await getInvoiceStatusCounts();
  const reviewCount = ["needs_review", "new", "failed"].reduce(
    (acc, s) => acc + Number(statusCountsRaw.find((c) => c.status === s)?.count ?? 0),
    0,
  );

  const displayName = auth.user.name ?? auth.organization?.name ?? auth.user.email ?? "";
  const userEmail = auth.user.email ?? undefined;
  const avatarUrl = auth.user.avatarUrl ?? undefined;
  const initials =
    displayName
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((part: string) => part[0]?.toUpperCase())
      .join("") || "?";

  return (
    <div className="flex min-h-screen flex-col bg-surface">
      {/* A11Y (INFETCH-103): Skip-Link für Tastatur-Nutzer und Screen-Reader */}
      <a
        href="#main-content"
        className="absolute -top-full left-4 z-50 rounded bg-ink px-4 py-2 text-sm font-medium text-white focus:top-4 focus:outline-none"
      >
        Zum Hauptinhalt springen
      </a>
      <TopBar
        reviewCount={reviewCount}
        initials={initials}
        userName={displayName}
        userEmail={userEmail}
        avatarUrl={avatarUrl}
        autoPilotEnabled={appConfig.features.autoPilotEnabled}
      />
      <main
        id="main-content"
        data-testid="app-main"
        tabIndex={-1}
        className="mx-auto w-full max-w-[1180px] flex-1 px-4 py-4 outline-none md:p-8"
      >
        {children}
      </main>
      <AppFooter />
    </div>
  );
}

function AppFooter() {
  return (
    <footer className="mt-12 border-t border-line">
      <div className="mx-auto flex max-w-[1180px] flex-col gap-3 px-4 py-6 text-xs text-muted md:flex-row md:items-center md:gap-6 md:px-8">
        <div className="flex items-center gap-2">
          <Image
            src="/infetch-logo.svg"
            alt=""
            width={64}
            height={20}
            className="h-5 w-auto opacity-80"
            draggable={false}
          />
          <span>© 2026 Infetch</span>
        </div>
        <nav className="flex flex-wrap items-center gap-x-5 gap-y-1 md:ml-auto" aria-label="Footer-Navigation">
          <Link href="/einstellungen" className="hover:text-ink">Status</Link>
          <a href="#" className="hover:text-ink">Datenschutz</a>
          <a href="#" className="hover:text-ink">AGB</a>
          <a href="#" className="hover:text-ink">Impressum</a>
          <SupportFooterLink />
        </nav>
      </div>
    </footer>
  );
}
