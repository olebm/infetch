"use client";

import { useEffect, useState } from "react";
import dynamic from "next/dynamic";

// PERFORMANCE: Modal+Formular (~270 LOC) zählen bis zum ersten Kontakt-Klick
// als "Unused JavaScript". Dynamic-Import lädt das Chunk erst beim Öffnen.
const ContactModal = dynamic(
  () => import("@/components/ui/contact-modal").then((m) => m.ContactModal),
  { ssr: false },
);

/**
 * Thin client island that handles two responsibilities:
 * 1. Scroll-reveal: adds `.in` to every `.reveal` element when it enters viewport.
 * 2. Contact modal: opens on any click that reaches an element with [data-contact].
 *
 * The landing page itself is a Server Component — this is the only client bundle.
 */
export function ContactController() {
  const [open, setOpen] = useState(false);
  const [primed, setPrimed] = useState(false); // erstes Öffnen triggert Chunk-Load

  useEffect(() => {
    // Reveal observer
    const io = new IntersectionObserver(
      (entries) =>
        entries.forEach((e) => {
          if (e.isIntersecting) e.target.classList.add("in");
        }),
      { threshold: 0.15 },
    );
    document.querySelectorAll(".reveal").forEach((el) => io.observe(el));

    // Contact modal — click delegation so the server-rendered buttons work
    function handleClick(e: MouseEvent) {
      if ((e.target as Element).closest("[data-contact]")) {
        setPrimed(true);
        setOpen(true);
      }
    }
    document.addEventListener("click", handleClick);

    return () => {
      io.disconnect();
      document.removeEventListener("click", handleClick);
    };
  }, []);

  if (!primed) return null;
  return <ContactModal open={open} onClose={() => setOpen(false)} />;
}
