import Link from "next/link";
import { AlertTriangle } from "lucide-react";

export function MailInvalidBanner() {
  return (
    <div className="flex items-center justify-between gap-4 border-b border-danger/20 bg-danger/5 px-4 py-2.5">
      <div className="flex items-center gap-2 text-sm text-danger">
        <AlertTriangle size={14} className="shrink-0" aria-hidden />
        <span>
          <strong>Postfach nicht erreichbar</strong> — das App-Passwort ist abgelaufen oder wurde
          widerrufen.
        </span>
      </div>
      <Link
        href="/einstellungen"
        className="shrink-0 rounded border border-danger/30 px-3 py-1 text-xs font-medium text-danger hover:bg-danger/10"
      >
        Passwort erneuern →
      </Link>
    </div>
  );
}
