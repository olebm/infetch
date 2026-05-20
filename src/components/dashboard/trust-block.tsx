import { Shield, Globe2, FileCheck, Lock } from "lucide-react";

type TrustItem = {
  icon: typeof Shield;
  label: string;
  detail: string;
};

// SaaS-konsistente Trust-Statements (INFETCH-128). Vorher gab es Local-First-
// Reste ("Daten bei dir · PDFs bleiben lokal", "Open Source · AGPL"), die der
// SaaS-Realität (Cloud-Hosting auf Hetzner Frankfurt, kommerzielles Produkt)
// widersprachen und Vertrauen gekostet haben.
const ITEMS: TrustItem[] = [
  { icon: Lock, label: "Verschlüsselt", detail: "AES-256 · at rest & in transit" },
  { icon: Globe2, label: "EU-Hosting", detail: "Frankfurt · DSGVO" },
  { icon: FileCheck, label: "AVV inklusive", detail: "Art. 28 DSGVO" },
  { icon: Shield, label: "Datensparsam", detail: "cookieloses Tracking, kein Marketing-Profil" },
];

export function TrustBlock() {
  return (
    <div className="rounded-lg border border-line bg-paper p-5">
      <ul className="grid grid-cols-1 gap-5 sm:grid-cols-2 md:grid-cols-4">
        {ITEMS.map((item) => {
          const Icon = item.icon;
          return (
            <li key={item.label} className="flex items-start gap-3">
              <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded border border-line bg-surface">
                <Icon className="h-3.5 w-3.5 text-muted" aria-hidden />
              </div>
              <div className="min-w-0">
                <div className="text-sm font-medium text-ink">{item.label}</div>
                <div className="text-xs text-muted">{item.detail}</div>
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
