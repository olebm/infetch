"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import {
  markInvoicePrivateAction,
  markSenderDomainPrivateAction,
  restoreInvoiceFromPrivateAction,
} from "@/app/(app)/audit/actions";

// ─── "privat" hover button + popover (non-private rows) ───────────────────────

export function PrivatButton({
  invoiceId,
  domain,
}: {
  invoiceId: number;
  domain: string | null;
}) {
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const ref = useRef<HTMLDivElement>(null);
  // A11Y (INFETCH-102): Fokus-Verwaltung — Trigger merken + erstes Menu-Item fokussieren
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  // Wenn Menü öffnet: erstes focusbares Element fokussieren
  useEffect(() => {
    if (open) {
      const first = menuRef.current?.querySelector<HTMLElement>("button, [href]");
      first?.focus();
    }
  }, [open]);

  function closeMenu() {
    setOpen(false);
    // Fokus zurück zum auslösenden Element
    triggerRef.current?.focus();
  }

  function handleOnce(e: React.MouseEvent) {
    e.preventDefault();
    e.stopPropagation();
    startTransition(async () => {
      await markInvoicePrivateAction(invoiceId);
    });
    closeMenu();
  }

  function handleAlways(e: React.MouseEvent) {
    e.preventDefault();
    e.stopPropagation();
    if (!domain) return;
    startTransition(async () => {
      await markSenderDomainPrivateAction(domain);
    });
    closeMenu();
  }

  function toggle(e: React.MouseEvent) {
    e.preventDefault();
    e.stopPropagation();
    setOpen((v) => !v);
  }

  return (
    <div ref={ref} className="relative" onClick={(e) => e.stopPropagation()}>
      <button
        ref={triggerRef}
        type="button"
        onClick={toggle}
        disabled={pending}
        aria-label="Als privat markieren"
        aria-expanded={open}
        aria-haspopup="menu"
        aria-controls={`privat-menu-${invoiceId}`}
        className="inline-flex min-h-[44px] items-center whitespace-nowrap text-xs text-muted underline decoration-line underline-offset-4 transition-opacity hover:text-ink focus-visible:opacity-100 focus-visible:outline-none disabled:cursor-not-allowed opacity-100 sm:opacity-0 sm:group-hover/row:opacity-100"
      >
        {pending ? "…" : "privat"}
      </button>

      {open && (
        <>
          {/* backdrop */}
          <div
            className="fixed inset-0 z-10"
            aria-hidden
            onClick={(e) => { e.stopPropagation(); closeMenu(); }}
          />
          {/* A11Y (INFETCH-102): role="menu" + Escape-Taste + Fokus-Rückgabe */}
          <div
            ref={menuRef}
            id={`privat-menu-${invoiceId}`}
            role="menu"
            aria-label="Als privat markieren"
            onKeyDown={(e) => { if (e.key === "Escape") { e.stopPropagation(); closeMenu(); } }}
            className="absolute right-0 top-full z-20 mt-1.5 w-64 overflow-hidden rounded-md border border-line bg-white shadow-pop text-left"
          >
            <div className="px-3 pb-2 pt-3 text-[11px] text-muted" aria-hidden>Als privat markieren</div>
            <button
              type="button"
              role="menuitem"
              onClick={handleOnce}
              className="w-full px-3 py-2.5 text-left transition-colors hover:bg-line/40 focus-visible:bg-line/40 focus-visible:outline-none"
            >
              <div className="text-sm text-ink">Nur diese Rechnung</div>
              <div className="mt-0.5 text-[11px] text-muted">Wird nicht weitergeleitet.</div>
            </button>
            {domain && (
              <button
                type="button"
                role="menuitem"
                onClick={handleAlways}
                className="w-full border-t border-line px-3 py-2.5 text-left transition-colors hover:bg-line/40 focus-visible:bg-line/40 focus-visible:outline-none"
              >
                <div className="text-sm text-ink">
                  Alle künftigen von{" "}
                  <span className="stat-num">{domain}</span>
                </div>
                <div className="mt-0.5 text-[11px] text-muted">
                  Anbieter wird ignoriert. Rückgängig in Einstellungen.
                </div>
              </button>
            )}
            <button
              type="button"
              role="menuitem"
              onClick={(e) => { e.stopPropagation(); closeMenu(); }}
              className="w-full border-t border-line px-3 py-2 text-left text-[11px] text-muted hover:text-ink focus-visible:bg-line/40 focus-visible:outline-none"
            >
              Abbrechen
            </button>
          </div>
        </>
      )}
    </div>
  );
}

// ─── "wiederherstellen" button (Privat-Tab rows) ──────────────────────────────

export function WiederherstellenButton({ invoiceId }: { invoiceId: number }) {
  const [pending, startTransition] = useTransition();

  function handle(e: React.MouseEvent) {
    e.preventDefault();
    e.stopPropagation();
    startTransition(async () => {
      await restoreInvoiceFromPrivateAction(invoiceId);
    });
  }

  return (
    <button
      type="button"
      onClick={handle}
      disabled={pending}
      aria-label="Rechnung wiederherstellen"
      className="inline-flex min-h-[44px] items-center whitespace-nowrap text-xs text-muted underline decoration-line underline-offset-4 transition-opacity hover:text-ink focus-visible:opacity-100 focus-visible:outline-none opacity-100 sm:opacity-0 sm:group-hover/row:opacity-100 disabled:opacity-50"
    >
      {pending ? "…" : "wiederherstellen"}
    </button>
  );
}
