import Script from "next/script";

/**
 * Cookielose, DSGVO-freundliche Analytics (Plausible). Rendert nur, wenn
 * NEXT_PUBLIC_PLAUSIBLE_DOMAIN gesetzt ist — standardmäßig also deaktiviert.
 *
 *   NEXT_PUBLIC_PLAUSIBLE_DOMAIN=infetch.de
 *   NEXT_PUBLIC_PLAUSIBLE_SRC=https://plausible.io/js/script.js   (optional;
 *     für self-hosted Instanz auf eigene URL setzen)
 */
export function PlausibleAnalytics() {
  const domain = process.env.NEXT_PUBLIC_PLAUSIBLE_DOMAIN;
  if (!domain) return null;

  const src =
    process.env.NEXT_PUBLIC_PLAUSIBLE_SRC ?? "https://plausible.io/js/script.js";

  return <Script defer data-domain={domain} src={src} strategy="afterInteractive" />;
}
