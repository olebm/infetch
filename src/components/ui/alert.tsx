import { AlertCircle, AlertTriangle, CheckCircle2, Info } from "lucide-react";

export type AlertTone = "info" | "warning" | "danger" | "success";

const TONE_CLASSES: Record<AlertTone, string> = {
  info: "border-brand/30 bg-brand-soft text-brand-deep",
  warning: "border-warn/30 bg-warn-soft text-warn",
  danger: "border-danger/30 bg-danger-soft text-danger",
  success: "border-ok/30 bg-ok-soft text-ok",
};

const TONE_ICONS: Record<AlertTone, typeof AlertCircle> = {
  info: Info,
  warning: AlertTriangle,
  danger: AlertCircle,
  success: CheckCircle2,
};

type AlertProps = {
  tone?: AlertTone;
  title?: React.ReactNode;
  children?: React.ReactNode;
  className?: string;
  icon?: typeof AlertCircle;
};

export function Alert({ tone = "info", title, children, className = "", icon }: AlertProps) {
  const Icon = icon ?? TONE_ICONS[tone];
  // A11Y (INFETCH-105): danger/warning → role="alert" (assertive), andere → role="status" (polite)
  return (
    <div
      role={tone === "danger" || tone === "warning" ? "alert" : "status"}
      aria-live={tone === "danger" || tone === "warning" ? "assertive" : "polite"}
      aria-atomic="true"
      className={`flex items-start gap-3 rounded border px-4 py-3 text-sm ${TONE_CLASSES[tone]} ${className}`}
    >
      <Icon className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
      <div className="min-w-0 flex-1">
        {title && <div className="font-semibold">{title}</div>}
        {children && <div className={title ? "mt-0.5 text-xs opacity-80" : ""}>{children}</div>}
      </div>
    </div>
  );
}
