import { forwardRef } from "react";

type CardProps = React.HTMLAttributes<HTMLDivElement> & {
  padding?: "sm" | "md" | "lg" | "none";
  tone?: "default" | "subtle" | "ghost";
};

const PADDING: Record<NonNullable<CardProps["padding"]>, string> = {
  none: "",
  sm: "p-3",
  md: "p-4",
  lg: "p-5",
};

export const Card = forwardRef<HTMLDivElement, CardProps>(function Card(
  { padding = "md", tone = "default", className = "", ...props },
  ref,
) {
  const bg =
    tone === "subtle" ? "bg-surface" : tone === "ghost" ? "bg-transparent" : "bg-paper";
  const border = tone === "ghost" ? "" : "border border-line";
  return (
    <div
      ref={ref}
      className={`rounded-md ${border} ${bg} ${PADDING[padding]} ${className}`}
      {...props}
    />
  );
});

export function CardHeader({
  title,
  description,
  action,
}: {
  title: React.ReactNode;
  description?: React.ReactNode;
  action?: React.ReactNode;
}) {
  return (
    <div className="mb-3 flex items-start justify-between gap-3">
      <div className="min-w-0">
        <h2 className="text-sm font-medium text-ink">{title}</h2>
        {description && <p className="mt-0.5 text-xs text-muted">{description}</p>}
      </div>
      {action && <div className="shrink-0">{action}</div>}
    </div>
  );
}
