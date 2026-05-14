function formatRelative(iso: string): string {
  const ts = new Date(iso.includes("T") ? iso : iso.replace(" ", "T") + "Z");
  if (Number.isNaN(ts.getTime())) return iso;
  const diffSec = Math.round((Date.now() - ts.getTime()) / 1000);
  if (diffSec < 60) return "gerade eben";
  const diffMin = Math.round(diffSec / 60);
  if (diffMin < 60) return `vor ${diffMin} Min.`;
  const diffH = Math.round(diffMin / 60);
  if (diffH < 24) return `vor ${diffH} Std.`;
  const diffD = Math.round(diffH / 24);
  if (diffD < 31) return `vor ${diffD} Tagen`;
  return ts.toLocaleDateString("de-DE", { dateStyle: "short" });
}

export function VerifiedAt({ value, prefix = "Zuletzt verifiziert" }: { value: string | null; prefix?: string }) {
  if (!value) return <span className="text-xs text-muted">{prefix}: noch nicht geprüft</span>;
  return (
    <span className="text-xs text-muted" title={value}>
      {prefix}: {formatRelative(value)}
    </span>
  );
}
