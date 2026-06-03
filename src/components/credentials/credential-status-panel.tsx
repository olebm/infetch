import { appConfig } from "@/lib/config/env";
import { getCredentialSummaries } from "@/lib/db/queries";
import { StatusBadge } from "@/components/status/status-badge";

const defaultRows = [
  { label: "Mein Postfach", scope: "imap", detail: "Hier holen wir deine Rechnungen ab" },
  { label: "Versand-Adresse", scope: "smtp", detail: "Hier verschicken wir an deine Buchhaltung" },
  { label: "KI-Erkennung", scope: "mistral", detail: "Liest Beträge und Daten automatisch aus" },
  {
    label: "Online-Konten",
    scope: "portal",
    detail: "Optional, für Auto-Abholen aus Lieferanten-Portalen",
  },
];

export async function CredentialStatusPanel() {
  const credentials = await getCredentialSummaries();
  const rows = appConfig.features.enablePortals
    ? defaultRows
    : defaultRows.filter((row) => row.scope !== "portal");

  return (
    <div className="grid gap-4 md:grid-cols-2">
      {rows.map((row) => {
        const imapRows = credentials.filter(
          (credential) => credential.scope === row.scope && credential.status === "configured",
        );
        const stored =
          row.scope === "imap"
            ? imapRows[0]
            : credentials.find((credential) => credential.scope === row.scope);
        const isMistralEnv = row.scope === "mistral" && appConfig.mistral.configured;
        const status =
          row.scope === "imap"
            ? imapRows.length > 0
              ? "configured"
              : "missing_secret"
            : stored?.status || (isMistralEnv ? "configured" : "missing_secret");
        const source =
          row.scope === "imap"
            ? imapRows.length === 0
              ? "nicht eingerichtet"
              : `${formatSecretSource(imapRows[0]?.secretStore ?? "")}${imapRows.length > 1 ? ` (${imapRows.length} Konten)` : ""}`
            : stored?.secretStore || (isMistralEnv ? ".env.local" : "nicht eingerichtet");
        const lastVerifiedAt =
          row.scope === "imap"
            ? imapRows[0]?.lastVerifiedAt || null
            : stored?.lastVerifiedAt || null;

        return (
          <article key={row.scope} className="rounded border border-line bg-white p-4 shadow-soft">
            <div className="flex items-start justify-between gap-3">
              <div>
                <h2 className="text-sm font-semibold">{row.label}</h2>
                <p className="mt-1 text-xs text-muted">{row.detail}</p>
              </div>
              <StatusBadge status={status} />
            </div>
            <div className="mt-4 text-xs text-muted">Speicherort: {formatSecretSource(source)}</div>
            <div className="mt-1 text-xs text-muted">
              Zuletzt geprüft: {lastVerifiedAt || "noch nicht"}
            </div>
          </article>
        );
      })}
    </div>
  );
}

function formatSecretSource(source: string) {
  if (source === "os_keychain") return "Sicher im Schlüssel-Bund";
  if (source === "session_only") return "Nur diese Sitzung";
  return source;
}
