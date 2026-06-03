"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Home, Inbox, Settings } from "lucide-react";

const navItems = [
  { href: "/", label: "Übersicht", icon: Home },
  { href: "/audit", label: "Posteingang", icon: Inbox },
  { href: "/einstellungen", label: "Einstellungen", icon: Settings },
] as const;

function isActive(pathname: string, href: string) {
  if (href === "/") return pathname === "/";
  return pathname === href || pathname.startsWith(`${href}/`);
}

export function NavLinks({ variant }: { variant: "sidebar" | "mobile" }) {
  const pathname = usePathname() || "/";

  if (variant === "sidebar") {
    return (
      <>
        {navItems.map((item) => {
          const active = isActive(pathname, item.href);
          const Icon = item.icon;
          return (
            <Link
              key={item.href}
              href={item.href}
              aria-current={active ? "page" : undefined}
              className={`flex h-10 items-center gap-2.5 rounded px-3 text-sm font-medium transition-colors ${
                active ? "bg-brand-soft text-brand-deep" : "text-ink hover:bg-surface"
              }`}
            >
              <Icon
                className={`h-[18px] w-[18px] ${active ? "text-brand" : "text-muted"}`}
                aria-hidden
              />
              {item.label}
            </Link>
          );
        })}
      </>
    );
  }

  return (
    <>
      {navItems.map((item) => {
        const active = isActive(pathname, item.href);
        const Icon = item.icon;
        return (
          <Link
            key={item.href}
            href={item.href}
            aria-current={active ? "page" : undefined}
            className={`inline-flex shrink-0 items-center gap-2 rounded border px-3 py-2 text-sm font-medium transition-colors ${
              active
                ? "border-brand/0 bg-brand-soft text-brand-deep"
                : "border-line bg-white text-ink"
            }`}
          >
            <Icon className={`h-4 w-4 ${active ? "text-brand" : "text-muted"}`} aria-hidden />
            {item.label}
          </Link>
        );
      })}
    </>
  );
}
