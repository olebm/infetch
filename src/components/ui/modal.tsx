"use client";

import { useEffect, useCallback, useRef } from "react";
import { createPortal } from "react-dom";
import { X } from "lucide-react";
import { cn } from "@/lib/utils";

interface ModalProps {
  open: boolean;
  onClose: () => void;
  title?: string;
  children: React.ReactNode;
  footer?: React.ReactNode;
  /** Max width class, default "max-w-md" */
  size?: "sm" | "md" | "lg";
}

const SIZE: Record<NonNullable<ModalProps["size"]>, string> = {
  sm: "max-w-sm",
  md: "max-w-md",
  lg: "max-w-lg",
};

// A11Y (INFETCH-101): Alle fokussierbaren Elemente im Container finden.
const FOCUSABLE_SELECTORS =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

function getFocusable(container: HTMLElement | null): HTMLElement[] {
  if (!container) return [];
  return Array.from(container.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTORS));
}

export function Modal({ open, onClose, title, children, footer, size = "md" }: ModalProps) {
  const dialogRef = useRef<HTMLDivElement>(null);
  // Fokus-Rückkehr: Element das vor dem Öffnen aktiv war merken
  const triggerRef = useRef<HTMLElement | null>(null);

  // Escape-Taste + Body-Scroll-Lock
  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        onClose();
        return;
      }
      // A11Y (INFETCH-101): Fokus-Trap — Tab bleibt innerhalb des Dialogs
      if (e.key === "Tab") {
        const focusable = getFocusable(dialogRef.current);
        if (!focusable.length) return;
        const first = focusable[0];
        const last = focusable[focusable.length - 1];
        if (e.shiftKey) {
          if (document.activeElement === first) {
            e.preventDefault();
            last.focus();
          }
        } else {
          if (document.activeElement === last) {
            e.preventDefault();
            first.focus();
          }
        }
      }
    },
    [onClose],
  );

  useEffect(() => {
    if (!open) return;

    // Fokus-Quelle sichern (für Rückkehr beim Schließen)
    triggerRef.current = document.activeElement as HTMLElement;

    // Erstes fokussierbares Element im Dialog fokussieren
    const focusable = getFocusable(dialogRef.current);
    const target = focusable[0] ?? dialogRef.current;
    target?.focus();

    document.addEventListener("keydown", handleKeyDown);
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    return () => {
      document.removeEventListener("keydown", handleKeyDown);
      document.body.style.overflow = prevOverflow;
      // A11Y: Fokus zum auslösenden Element zurückgeben
      triggerRef.current?.focus();
      triggerRef.current = null;
    };
  }, [open, handleKeyDown]);

  if (!open) return null;

  return createPortal(
    // Mobile: items-end → Bottom-Sheet (klebt am unteren Rand, volle Breite)
    // Desktop sm+: items-center → zentriert wie gewohnt
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center sm:p-4">
      {/* Overlay */}
      <div
        className="absolute inset-0 bg-ink/40 backdrop-blur-[2px]"
        onClick={onClose}
        aria-hidden
      />

      {/* Dialog — auf Mobile Bottom-Sheet, auf Desktop zentriert + gerundet */}
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={title ? "modal-title" : undefined}
        tabIndex={-1}
        className={cn(
          "relative flex w-full flex-col",
          "max-h-[92dvh]",                       // nie höher als 92% Viewport
          "rounded-t-xl sm:rounded-xl",          // oben gerundet auf Mobile, rundum auf Desktop
          "border border-line/60 bg-paper shadow-pop",
          "outline-none",                        // Fokus-Ring via tabIndex=-1 unterdrücken
          SIZE[size],
        )}
      >
        {/* Header */}
        {title && (
          <div className="flex-none flex items-center justify-between border-b border-line/60 px-5 py-4">
            <h2 id="modal-title" className="text-sm font-semibold text-ink">
              {title}
            </h2>
            <button
              type="button"
              onClick={onClose}
              className="flex h-9 w-9 items-center justify-center rounded-md text-muted transition hover:bg-surface hover:text-ink"
              aria-label="Schließen"
            >
              <X className="h-4 w-4" aria-hidden />
            </button>
          </div>
        )}

        {/* Body — scrollbar wenn Inhalt länger als Viewport */}
        <div className="flex-1 overflow-y-auto overscroll-contain p-5">{children}</div>

        {/* Footer */}
        {footer && (
          <div className="flex-none flex items-center justify-end gap-2 border-t border-line/60 px-5 py-4">
            {footer}
          </div>
        )}
      </div>
    </div>,
    document.body,
  );
}
