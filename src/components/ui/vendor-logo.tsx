"use client";

import { useEffect, useRef, useState } from "react";
export { formatVendorName } from "@/lib/vendor-utils";
import { rootDomain } from "@/lib/vendor-utils";

const BRANDFETCH_TOKEN = process.env.NEXT_PUBLIC_BRANDFETCH_TOKEN ?? "";

// Transparent 1×1 placeholder — prevents the browser's broken-image icon
// while the real logo is loading (Brandfetch-recommended pattern).
const TRANSPARENT_PX =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=";

/** Neutral monogram background — consistent, unobtrusive placeholder. */
const MONOGRAM_BG = "#dbd8d0";
const MONOGRAM_FG = "#151a22";

type VendorLogoProps = {
  domain?: string | null;
  /** Vendor name — accepts `name` (design alias) or `vendorName` (legacy). */
  name?: string | null;
  vendorName?: string | null;
  /** Pixel size (width = height). Default 32. */
  size?: number;
  className?: string;
};

/**
 * Vendor logo badge.
 *
 * Source chain:
 *   1. Brandfetch CDN  — when NEXT_PUBLIC_BRANDFETCH_TOKEN is set (HiDPI, icon type).
 *   2. Seeded monogram — first letter, earthy background, always works.
 *
 * SSR-safe: a useEffect checks after hydration whether the image already
 * failed before React's event handlers were attached (Next.js SSR timing issue).
 */
export function VendorLogo({
  domain,
  name,
  vendorName,
  size = 32,
  className = "",
}: VendorLogoProps) {
  const [srcIndex, setSrcIndex] = useState(0);
  const imgRef = useRef<HTMLImageElement | null>(null);

  const displayName = name ?? vendorName ?? "?";
  const cleaned = displayName.replace(/[^A-Za-zÄÖÜäöü]/g, "");
  const initial = (cleaned[0] || "?").toUpperCase();

  const logoHost = rootDomain(domain);

  // Brandfetch CDN (token required) → monogram fallback.
  // 256 px — scharf bis 3× HiDPI, unabhängig von `size`.
  // fallback/404 → CDN returns HTTP 404 when the brand has no icon, so our
  // onError handler falls through to the monogram instead of showing the
  // Brandfetch "bf" placeholder logo (the default fallback for type=icon).
  const sources: string[] = logoHost && BRANDFETCH_TOKEN
    ? [`https://cdn.brandfetch.io/${logoHost}/w/256/h/256/fallback/404/icon?c=${BRANDFETCH_TOKEN}`]
    : [];

  function advance() {
    const img = imgRef.current;
    if (img) img.src = TRANSPARENT_PX; // prevent broken-image flash
    setSrcIndex((i) => i + 1);
  }

  // After hydration (or after each source change), check whether the image
  // already completed loading with no pixels — happens when the browser fetches
  // the SSR-rendered src before React mounts and attaches event handlers.
  useEffect(() => {
    const img = imgRef.current;
    if (img && img.complete && img.naturalWidth === 0) {
      advance();
    }
  }, [srcIndex]);

  // ── Monogram fallback ────────────────────────────────────────────────────────
  if (sources.length === 0 || srcIndex >= sources.length) {
    return (
      <div
        className={`rounded-full inline-flex shrink-0 select-none items-center justify-center font-medium ${className}`}
        style={{
          width: size,
          height: size,
          background: MONOGRAM_BG,
          color: MONOGRAM_FG,
          fontSize: Math.round(size * 0.42),
        }}
        aria-hidden
      >
        {initial}
      </div>
    );
  }

  // ── Logo from source chain ───────────────────────────────────────────────────
  return (
    <div
      className={`rounded-full inline-flex shrink-0 items-center justify-center overflow-hidden bg-white ${className}`}
      style={{ width: size, height: size }}
    >
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        ref={imgRef}
        src={sources[srcIndex]}
        alt=""
        width={256}
        height={256}
        // PERFORMANCE: Brandfetch-CDN-Logos sind nie LCP — Browser darf sie
        // verzögert holen und async decoden. Verhindert Konkurrenz um Bandbreite
        // mit Hero-Bild und Schriften.
        loading="lazy"
        decoding="async"
        onError={advance}
        onLoad={(e) => {
          // Catch 0-byte responses that don't trigger onError
          if ((e.currentTarget as HTMLImageElement).naturalWidth === 0) advance();
        }}
        style={{ width: size, height: size, objectFit: "contain" }}
      />
    </div>
  );
}
