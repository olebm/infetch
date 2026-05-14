"use client";

import { useEffect, useState } from "react";
import { ContactModal } from "@/components/ui/contact-modal";

/**
 * Thin client island that handles two responsibilities:
 * 1. Scroll-reveal: adds `.in` to every `.reveal` element when it enters viewport.
 * 2. Contact modal: opens on any click that reaches an element with [data-contact].
 *
 * The landing page itself is a Server Component — this is the only client bundle.
 */
export function ContactController() {
  const [open, setOpen] = useState(false);

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
      if ((e.target as Element).closest("[data-contact]")) setOpen(true);
    }
    document.addEventListener("click", handleClick);

    return () => {
      io.disconnect();
      document.removeEventListener("click", handleClick);
    };
  }, []);

  return <ContactModal open={open} onClose={() => setOpen(false)} />;
}
