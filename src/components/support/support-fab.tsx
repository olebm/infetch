"use client";

import { MessageCircleQuestion } from "lucide-react";
import { useSupportModal } from "@/components/support/support-provider";

/**
 * Floating Action Button — öffnet das Support-Modal.
 * Position: fixed bottom-right, über dem normalen Content-Layer.
 * Auf mobil: bottom-5 right-4 (kleiner Abstand vom Rand).
 */
export function SupportFab() {
  const { open } = useSupportModal();

  return (
    <button
      type="button"
      onClick={open}
      aria-label="Support öffnen"
      title="Hilfe & Support"
      className="fixed bottom-6 right-6 z-40 group flex items-center gap-2 rounded-full bg-ink px-4 py-2.5 text-white shadow-lg hover:bg-ink/90 transition-all duration-150 hover:pr-5 max-sm:bottom-4 max-sm:right-4"
    >
      <MessageCircleQuestion
        size={17}
        aria-hidden
        className="shrink-0"
      />
      {/* Label — always visible on md+, icon-only on mobile */}
      <span className="hidden text-xs font-medium md:inline whitespace-nowrap">
        Hilfe
      </span>
    </button>
  );
}

/**
 * Support-Link für den Footer — öffnet dasselbe Modal.
 */
export function SupportFooterLink() {
  const { open } = useSupportModal();

  return (
    <button
      type="button"
      onClick={open}
      className="hover:text-ink transition-colors"
    >
      Support
    </button>
  );
}
