import Script from "next/script";

/**
 * Cookielose, DSGVO-freundliche Analytics (Plausible) im init()-API-Modus.
 * Nutzt async + JS-Queue statt data-domain/defer — passt zu Custom-Hash-
 * Script-Pfaden (Ad-Blocker-resistent). Rendert nur, wenn
 * NEXT_PUBLIC_PLAUSIBLE_SRC gesetzt ist:
 *
 *   NEXT_PUBLIC_PLAUSIBLE_SRC=https://analytics.example.com/js/pa-HASH.js
 */
const INIT_SNIPPET = `window.plausible=window.plausible||function(){(plausible.q=plausible.q||[]).push(arguments)},plausible.init=plausible.init||function(i){plausible.o=i||{}};plausible.init()`;

export function PlausibleAnalytics() {
  const src = process.env.NEXT_PUBLIC_PLAUSIBLE_SRC;
  if (!src) return null;

  return (
    <>
      <Script id="plausible-loader" src={src} strategy="afterInteractive" />
      <Script id="plausible-init" strategy="afterInteractive">
        {INIT_SNIPPET}
      </Script>
    </>
  );
}
