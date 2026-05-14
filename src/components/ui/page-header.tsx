import type { ReactNode } from "react";

interface PageHeaderProps {
  title: ReactNode;
  /** Optional eyebrow label above the title (small, uppercase, muted) */
  eyebrow?: string;
  /** Short prose under the title — appears in muted, max-w-xl */
  subline?: ReactNode;
  /** Optional action cluster, right-aligned on md+ */
  actions?: ReactNode;
}

/**
 * Editorial page header — pixel-matches Claude Design's PageHeader.
 *
 * Title uses `.font-display` at `text-5xl md:text-6xl leading-[0.95]` for a quiet
 * but commanding masthead. Subline + actions wrap below on mobile, right-align
 * on md+. Big bottom margin (`mb-10 md:mb-14`) — pages breathe.
 */
export function PageHeader({ title, eyebrow, subline, actions }: PageHeaderProps) {
  return (
    <div className="mb-6 flex flex-col gap-4 sm:mb-10 md:mb-14 md:flex-row md:items-end md:justify-between">
      <div>
        {eyebrow && (
          <p className="mb-1 text-xs font-medium uppercase tracking-wide text-muted">{eyebrow}</p>
        )}
        <h1 className="font-display text-3xl leading-[0.95] text-ink sm:text-5xl md:text-6xl">
          {title}
        </h1>
        {subline && (
          <p className="mt-3 max-w-xl text-sm text-muted">{subline}</p>
        )}
      </div>
      {actions && (
        <div className="flex flex-wrap items-center gap-2">{actions}</div>
      )}
    </div>
  );
}
