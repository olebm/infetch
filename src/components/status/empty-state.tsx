import Link from "next/link";

export function EmptyState({
  title,
  body,
  action,
}: {
  title: string;
  body: string;
  action?: { label: string; href: string };
}) {
  return (
    <div className="rounded border border-dashed border-line bg-white px-6 py-10 text-center">
      <div className="text-sm font-semibold text-ink">{title}</div>
      <p className="mx-auto mt-2 max-w-md text-sm text-muted">{body}</p>
      {action && (
        <Link
          href={action.href}
          className="mt-4 inline-flex items-center rounded bg-brand px-4 py-2 text-sm font-medium text-white"
        >
          {action.label}
        </Link>
      )}
    </div>
  );
}
