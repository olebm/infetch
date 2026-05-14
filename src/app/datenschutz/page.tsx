import type { Metadata } from "next";
import { PublicShell } from "@/components/layout/public-shell";

export const metadata: Metadata = {
  title: "Datenschutz — Infetch",
};

export default function DatenschutzPage() {
  return <PublicShell title="Datenschutzerklärung" />;
}
