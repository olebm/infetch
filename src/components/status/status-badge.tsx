import { cn } from "@/lib/utils";

// ─── Dot colour per status ────────────────────────────────────────────────────

type DotConfig = { dot: string; label: string };

// Labels match the design's casual delegation tone — short, lower-case.
const DOT_MAP: Record<string, DotConfig> = {
  // success / done
  succeeded:      { dot: "bg-ok",     label: "erfolgreich" },
  found:          { dot: "bg-ok",     label: "gefunden" },
  manual:         { dot: "bg-ok",     label: "manuell" },
  mail:           { dot: "bg-ok",     label: "mail" },
  portal:         { dot: "bg-ok",     label: "portal" },
  imported:       { dot: "bg-ok",     label: "importiert" },
  ready:          { dot: "bg-ok",     label: "bereit" },
  exported:       { dot: "bg-ok",     label: "verschickt" },
  sent:           { dot: "bg-ok",     label: "verschickt" },
  configured:     { dot: "bg-ok",     label: "aktiv" },
  active:         { dot: "bg-ok",     label: "aktiv" },
  ok:             { dot: "bg-ok",     label: "ok" },
  // warnings
  partial:        { dot: "bg-warn",   label: "teilweise" },
  needs_review:   { dot: "bg-warn",   label: "prüfen" },
  action_required:{ dot: "bg-warn",   label: "handlung nötig" },
  required:       { dot: "bg-warn",   label: "portal nötig" },
  login_required: { dot: "bg-warn",   label: "login nötig" },
  two_factor_required: { dot: "bg-warn", label: "2FA nötig" },
  missing_secret: { dot: "bg-warn",   label: "fehlt" },
  missing:        { dot: "bg-warn",   label: "fehlt" },
  retry:          { dot: "bg-warn",   label: "wird neu versucht" },
  // errors
  failed:         { dot: "bg-danger", label: "fehler" },
  error:          { dot: "bg-danger", label: "fehler" },
  invalid:        { dot: "bg-danger", label: "ungültig" },
  blocked:        { dot: "bg-danger", label: "blockiert" },
  locked:         { dot: "bg-danger", label: "gesperrt" },
  // neutral / info
  running:        { dot: "bg-brand",  label: "läuft" },
  new:            { dot: "bg-brand",  label: "neu" },
  pending:        { dot: "bg-muted",  label: "wartet" },
  queued:         { dot: "bg-muted",  label: "in der warteschlange" },
  unchecked:      { dot: "bg-muted",  label: "ungeprüft" },
  skipped:        { dot: "bg-muted",  label: "übersprungen" },
  cancelled:      { dot: "bg-muted",  label: "abgebrochen" },
  ignored:        { dot: "bg-muted",  label: "ignoriert" },
  duplicate:      { dot: "bg-muted",  label: "duplikat" },
  privat:         { dot: "bg-muted",  label: "privat" },
  disabled:       { dot: "bg-line",   label: "aus" },
  not_found:      { dot: "bg-muted",  label: "nicht gefunden" },
  not_needed:     { dot: "bg-line",   label: "nicht benötigt" },
  none:           { dot: "bg-line",   label: "keine Quelle" },
  not_implemented:{ dot: "bg-line",   label: "geplant" },
};

export type KnownStatus = keyof typeof DOT_MAP;

// ─── Component ────────────────────────────────────────────────────────────────

export function StatusBadge({
  status,
  label,
  mode = "user",
}: {
  status: string;
  label?: string;
  mode?: "user" | "debug";
}) {
  const cfg = DOT_MAP[status] ?? { dot: "bg-muted", label: status };
  const displayLabel = label ?? cfg.label;

  if (mode === "debug") {
    // In debug/technical panels: keep the pill style with token-based colours
    const pillClass = getPillClass(status);
    return (
      <span className={cn("inline-flex items-center gap-1.5 rounded border px-2 py-1 text-xs font-medium", pillClass)}>
        <span
          className={cn(
            "inline-block h-1.5 w-1.5 rounded-full",
            cfg.dot,
            status === "running" && "animate-ap-pulse",
          )}
          aria-hidden
        />
        {displayLabel}
      </span>
    );
  }

  // User mode: quiet dot + text, no background
  return (
    <span className="inline-flex items-center gap-1.5">
      <span
        className={cn(
          "inline-block h-1.5 w-1.5 shrink-0 rounded-full",
          cfg.dot,
          status === "running" && "animate-ap-pulse",
        )}
        aria-hidden
      />
      <span className="text-xs text-muted">{displayLabel}</span>
    </span>
  );
}

// ─── Pill colours for debug mode (token-based, no hardcoded hex) ──────────────

function getPillClass(status: string): string {
  const s = status.toLowerCase();
  if (["succeeded", "found", "manual", "mail", "portal", "imported", "ready", "exported", "sent", "configured", "active"].includes(s))
    return "border-ok/30 bg-ok-soft text-ok";
  if (["partial", "needs_review", "action_required", "required", "login_required", "two_factor_required", "missing_secret", "missing"].includes(s))
    return "border-warn/30 bg-warn-soft text-warn";
  if (["failed", "error", "invalid", "blocked", "locked"].includes(s))
    return "border-danger/30 bg-danger-soft text-danger";
  if (["running", "new"].includes(s))
    return "border-brand/30 bg-brand-soft text-ink";
  if (["duplicate"].includes(s))
    return "border-line bg-surface text-muted";
  return "border-line bg-surface text-muted";
}
