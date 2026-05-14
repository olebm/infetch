"use client";

import { forwardRef, type ComponentPropsWithoutRef, type CSSProperties } from "react";

const BULLET = "\u25CF";

function bulletRun(count: number) {
  return Array.from({ length: count }, () => BULLET).join("");
}

export type OverlaySecretPasswordInputProps = Omit<ComponentPropsWithoutRef<"input">, "type"> & {
  /** Shows placeholder circles inside the field (not the secret). */
  showStoredPlaceholder: boolean;
  /** Number of ● characters layered in the empty field. */
  bulletCount?: number;
};

/**
 * Password input with masked typing (discs) and optional in-field ●●●● placeholder when a secret is stored but the box is empty.
 */
export const OverlaySecretPasswordInput = forwardRef<HTMLInputElement, OverlaySecretPasswordInputProps>(
  ({ showStoredPlaceholder, bulletCount = 14, className: wrapperClassName, style, placeholder, ...inputProps }, ref) => {
    return (
      <div
        className={`relative w-full rounded border border-line bg-surface focus-within:ring-2 focus-within:ring-brand/25 ${wrapperClassName ?? ""}`}
      >
        {showStoredPlaceholder ? (
          <span
            className="pointer-events-none absolute inset-y-0 left-3 z-0 flex items-center truncate font-mono text-[13px] leading-none tracking-[0.28em] text-muted"
            aria-hidden
          >
            {bulletRun(bulletCount)}
          </span>
        ) : null}
        <input
          ref={ref}
          type="password"
          {...inputProps}
          placeholder={showStoredPlaceholder ? "" : placeholder}
          style={{
            ...style,
            WebkitTextSecurity: showStoredPlaceholder ? "none" : "disc",
          } as CSSProperties & { WebkitTextSecurity?: "none" | "disc" }}
          className={`relative z-[1] block w-full border-0 bg-transparent px-3 py-2 text-sm outline-none placeholder:text-muted/70 ${showStoredPlaceholder ? "text-transparent caret-neutral-900" : ""}`}
        />
        {showStoredPlaceholder ? (
          <span className="sr-only">Secret liegt im Secret Store. Die Kreise sind nur Platzhalter im Eingabefeld.</span>
        ) : null}
      </div>
    );
  },
);

OverlaySecretPasswordInput.displayName = "OverlaySecretPasswordInput";
