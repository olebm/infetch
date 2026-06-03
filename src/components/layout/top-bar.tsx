"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import Image from "next/image";
import { usePathname } from "next/navigation";
import { ChevronDown, Settings as SettingsIcon, Store, UserCircle } from "lucide-react";
import { logout } from "@/app/login/actions";
import { cn } from "@/lib/utils";

const NAV_ITEMS = [
  { href: "/", label: "Übersicht", key: "dashboard" },
  { href: "/audit", label: "Posteingang", key: "inbox" },
] as const;

function isActive(pathname: string, href: string) {
  if (href === "/") return pathname === "/";
  return pathname === href || pathname.startsWith(`${href}/`);
}

interface TopBarProps {
  reviewCount: number;
  initials: string;
  userName: string;
  userEmail?: string;
  avatarUrl?: string;
  autoPilotEnabled: boolean;
}

/**
 * App-Shell TopBar — pixel-matches Claude Design's TopBar.
 *
 * Layout: h-16 sticky, max-w-[1180px] inner with `px-4 md:px-8 gap-8`.
 * - Logo: actual hand-lettered SVG at `h-10` (NOT a wordmark text fallback).
 * - Active nav: full-height button (`h-16`) with absolute `h-px bg-ink`
 *   underline at bottom. Hover: `text-muted → text-ink`.
 * - Right cluster: Auto-Pilot pulse (lg+), "sofort holen", avatar + dropdown.
 */
export function TopBar({
  reviewCount,
  initials,
  userName,
  userEmail,
  avatarUrl,
  autoPilotEnabled,
}: TopBarProps) {
  const pathname = usePathname() || "/";
  const [mobileOpen, setMobileOpen] = useState(false);
  const [profileOpen, setProfileOpen] = useState(false);
  const profileRef = useRef<HTMLDivElement | null>(null);
  const profileTriggerRef = useRef<HTMLButtonElement | null>(null);
  const profileMenuRef = useRef<HTMLDivElement | null>(null);

  // Close dropdown on outside click
  useEffect(() => {
    if (!profileOpen) return;
    const close = (e: MouseEvent) => {
      if (!profileRef.current?.contains(e.target as Node)) setProfileOpen(false);
    };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, [profileOpen]);

  // A11Y (INFETCH-102): Fokus auf erstes Menu-Item wenn Dropdown öffnet
  useEffect(() => {
    if (!profileOpen) return;
    const first = profileMenuRef.current?.querySelector<HTMLElement>("a, button");
    first?.focus();
  }, [profileOpen]);

  return (
    <header
      className="sticky top-0 z-30 border-b border-line"
      style={{ backgroundColor: "rgb(251, 250, 247)" }}
    >
      <div className="mx-auto flex h-16 max-w-[1180px] items-center gap-8 px-4 md:px-8">
        {/* Logo — actual hand-lettered SVG from design bundle */}
        <Link
          href="/"
          className="shrink-0 flex items-center text-ink"
          aria-label="Infetch · zur Übersicht"
        >
          <Image
            src="/images/brand/infetch-logo.svg"
            alt="Infetch"
            width={128}
            height={40}
            className="h-10 w-auto select-none"
            priority
            draggable={false}
          />
        </Link>

        {/* Primary nav */}
        <nav className="hidden items-center gap-1 md:flex" aria-label="Hauptnavigation">
          {NAV_ITEMS.map(({ href, label }) => {
            const active = isActive(pathname, href);
            const isInbox = href === "/audit";
            return (
              <Link
                key={href}
                href={href}
                aria-current={active ? "page" : undefined}
                className={cn(
                  "relative inline-flex h-16 items-center gap-2 px-3 text-sm transition-colors",
                  active ? "font-medium text-ink" : "text-muted hover:text-ink",
                )}
              >
                <span>{label}</span>
                {isInbox && reviewCount > 0 && (
                  <span className="inline-flex h-[18px] min-w-[18px] items-center justify-center rounded-full bg-warn/15 px-1 text-[10px] font-medium tabular-nums text-warn">
                    {reviewCount > 99 ? "99+" : reviewCount}
                  </span>
                )}
                {active && <span className="absolute inset-x-3 bottom-0 h-px bg-ink" aria-hidden />}
              </Link>
            );
          })}
        </nav>

        {/* Right cluster */}
        <div className="ml-auto flex items-center gap-2">
          {/* Auto-Pilot status — lg+ */}
          {autoPilotEnabled && (
            <span className="hidden items-center gap-1.5 px-2 text-xs text-muted md:inline-flex">
              <span className="h-1.5 w-1.5 rounded-full bg-ok ap-pulse" aria-hidden />
              Auto-Pilot aktiv
            </span>
          )}

          {/* Profile avatar + dropdown */}
          <div className="relative hidden md:block" ref={profileRef}>
            <button
              ref={profileTriggerRef}
              type="button"
              onClick={() => setProfileOpen((v) => !v)}
              aria-expanded={profileOpen}
              aria-haspopup="menu"
              aria-controls="profile-menu"
              aria-label="Profil"
              className="inline-flex h-9 items-center gap-1 rounded pl-1 pr-1.5 hover:bg-[#f5f2ec]"
            >
              <span className="inline-flex h-7 w-7 items-center justify-center rounded-full bg-ink text-[11px] font-medium text-white overflow-hidden">
                {avatarUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={avatarUrl}
                    alt={userName || "Profilbild"}
                    className="h-full w-full object-cover"
                  />
                ) : (
                  initials || "·"
                )}
              </span>
              <ChevronDown className="h-3.5 w-3.5 text-muted" aria-hidden />
            </button>

            {profileOpen && (
              // A11Y (INFETCH-102): role="menu" + Escape-Taste + Fokus-Rückgabe
              <div
                id="profile-menu"
                ref={profileMenuRef}
                role="menu"
                aria-label="Profil-Menü"
                onKeyDown={(e) => {
                  if (e.key === "Escape") {
                    setProfileOpen(false);
                    profileTriggerRef.current?.focus();
                  }
                }}
                className="absolute right-0 z-40 mt-2 w-64 overflow-hidden rounded-md border border-line bg-white shadow-pop"
              >
                <div className="border-b border-line px-4 py-3" aria-hidden>
                  <div className="text-sm font-medium text-ink">{userName || "—"}</div>
                  {userEmail && <div className="truncate text-xs text-muted">{userEmail}</div>}
                </div>
                <div className="py-1">
                  <Link
                    href="/konto"
                    role="menuitem"
                    onClick={() => setProfileOpen(false)}
                    className="flex w-full items-center gap-2 px-4 py-2 text-sm text-ink hover:bg-[#f5f2ec] focus-visible:bg-[#f5f2ec] focus-visible:outline-none"
                  >
                    <UserCircle className="h-3.5 w-3.5 text-muted" aria-hidden />
                    Mein Konto
                  </Link>
                  <Link
                    href="/senders"
                    role="menuitem"
                    onClick={() => setProfileOpen(false)}
                    className="flex w-full items-center gap-2 px-4 py-2 text-sm text-ink hover:bg-[#f5f2ec] focus-visible:bg-[#f5f2ec] focus-visible:outline-none"
                  >
                    <Store className="h-3.5 w-3.5 text-muted" aria-hidden />
                    Anbieter
                  </Link>
                  <Link
                    href="/einstellungen"
                    role="menuitem"
                    onClick={() => setProfileOpen(false)}
                    className="flex w-full items-center gap-2 px-4 py-2 text-sm text-ink hover:bg-[#f5f2ec] focus-visible:bg-[#f5f2ec] focus-visible:outline-none"
                  >
                    <SettingsIcon className="h-3.5 w-3.5 text-muted" aria-hidden />
                    Einstellungen
                  </Link>
                </div>
                <div className="border-t border-line py-1">
                  <form action={logout}>
                    <button
                      type="submit"
                      role="menuitem"
                      className="block w-full px-4 py-2 text-left text-sm text-muted hover:bg-[#f5f2ec] hover:text-ink focus-visible:bg-[#f5f2ec] focus-visible:outline-none"
                    >
                      Abmelden
                    </button>
                  </form>
                </div>
              </div>
            )}
          </div>

          {/* Mobile hamburger */}
          <button
            type="button"
            onClick={() => setMobileOpen((v) => !v)}
            aria-expanded={mobileOpen}
            aria-label={mobileOpen ? "Navigation schließen" : "Navigation öffnen"}
            className="-m-2 p-2 text-ink md:hidden"
          >
            <svg
              width="20"
              height="20"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              aria-hidden
            >
              {mobileOpen ? (
                <path d="M6 6l12 12M6 18L18 6" />
              ) : (
                <path d="M3 12h18M3 6h18M3 18h18" />
              )}
            </svg>
          </button>
        </div>
      </div>

      {/* Mobile menu */}
      {mobileOpen && (
        <div
          className="border-t border-line md:hidden"
          style={{ backgroundColor: "rgb(251, 250, 247)" }}
        >
          <nav
            className="flex flex-col px-4 py-2 overscroll-contain"
            aria-label="Mobile Navigation"
          >
            {autoPilotEnabled && (
              <div className="flex h-10 items-center gap-2 px-2 text-sm text-muted">
                <span className="h-1.5 w-1.5 rounded-full bg-ok ap-pulse" aria-hidden />
                Auto-Pilot aktiv
              </div>
            )}
            {NAV_ITEMS.map(({ href, label }) => {
              const active = isActive(pathname, href);
              const isInbox = href === "/audit";
              return (
                <Link
                  key={href}
                  href={href}
                  onClick={() => setMobileOpen(false)}
                  className={cn(
                    "inline-flex h-11 items-center justify-between rounded px-2 text-sm",
                    active ? "font-medium text-ink" : "text-muted",
                  )}
                >
                  <span>{label}</span>
                  {isInbox && reviewCount > 0 && (
                    <span className="text-[11px] text-warn">{reviewCount}</span>
                  )}
                </Link>
              );
            })}
            <div className="mt-1 border-t border-line pt-1">
              {[
                { href: "/konto", label: "Mein Konto" },
                { href: "/senders", label: "Anbieter" },
                { href: "/einstellungen", label: "Einstellungen" },
              ].map(({ href, label }) => (
                <Link
                  key={href}
                  href={href}
                  onClick={() => setMobileOpen(false)}
                  className={cn(
                    "inline-flex h-11 w-full items-center rounded px-2 text-sm transition-colors focus-visible:bg-line/40 focus-visible:outline-none",
                    isActive(pathname, href) ? "font-medium text-ink" : "text-muted hover:text-ink",
                  )}
                >
                  {label}
                </Link>
              ))}
              <form action={logout}>
                <button
                  type="submit"
                  className="inline-flex h-11 w-full items-center rounded px-2 text-sm text-muted transition-colors hover:text-ink focus-visible:bg-line/40 focus-visible:outline-none"
                >
                  Abmelden
                </button>
              </form>
            </div>
          </nav>
        </div>
      )}
    </header>
  );
}
