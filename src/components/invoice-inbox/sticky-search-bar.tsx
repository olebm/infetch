"use client";

import { useEffect, useState } from "react";
import { InboxSearch } from "@/components/invoice-inbox/inbox-search";

/**
 * Sticky-Suchleiste — nur Mobile (`md:hidden`).
 *
 * Beim Seitenstart unsichtbar. Sobald der User > 50 px gescrollt hat,
 * blendet sie sich als fixierter Streifen direkt unter der TopBar ein.
 * Beim Zurückscrollt zur Seitenoberseite verschwindet sie wieder.
 *
 * `position: fixed` statt `sticky` → kein Layout-Shift beim Ein-/Ausblenden.
 */
export function StickySearchBar({
  initialValue,
  tab,
  year,
}: {
  initialValue?: string;
  tab: string;
  year?: string;
}) {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    function onScroll() {
      setVisible(window.scrollY > 200);
    }
    onScroll(); // Initialzustand prüfen (z. B. bei Browser-Back mit Scroll-Restore)
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  return (
    <div
      className={`fixed left-0 right-0 top-16 z-20 border-b border-line bg-[#fbfaf7] px-4 py-2 transition-[opacity,transform] duration-200 md:hidden ${
        visible
          ? "pointer-events-auto translate-y-0 opacity-100"
          : "pointer-events-none -translate-y-1 opacity-0"
      }`}
    >
      <InboxSearch
        initialValue={initialValue ?? ""}
        tab={tab}
        year={year}
        defaultTab="review"
        expanded
      />
    </div>
  );
}
