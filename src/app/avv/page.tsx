import type { Metadata } from "next";
import { PublicShell } from "@/components/layout/public-shell";

export const metadata: Metadata = {
  title: "AVV (DSGVO) — Infetch",
};

export default function AvvPage() {
  return <PublicShell title="Auftragsverarbeitungsvertrag (AVV)" />;
}
