import type { Metadata } from "next";
import { PublicShell } from "@/components/layout/public-shell";

export const metadata: Metadata = {
  title: "Changelog — Infetch",
  // Seite hat noch keinen Inhalt → nicht indexieren (Thin/Empty Content).
  // index:true wieder setzen, sobald echte Changelog-Einträge existieren.
  robots: { index: false, follow: true },
};

export default function ChangelogPage() {
  return <PublicShell title="Changelog" />;
}
