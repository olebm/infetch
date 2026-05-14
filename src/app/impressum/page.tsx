import type { Metadata } from "next";
import { PublicShell } from "@/components/layout/public-shell";

export const metadata: Metadata = {
  title: "Impressum — Infetch",
};

export default function ImpressumPage() {
  return <PublicShell title="Impressum" />;
}
