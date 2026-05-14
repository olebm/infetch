import type { Metadata } from "next";
import { PublicShell } from "@/components/layout/public-shell";

export const metadata: Metadata = {
  title: "AGB — Infetch",
};

export default function AgbPage() {
  return <PublicShell title="Allgemeine Geschäftsbedingungen" />;
}
