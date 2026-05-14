import type { Metadata } from "next";
import { PublicShell } from "@/components/layout/public-shell";

export const metadata: Metadata = {
  title: "Über uns — Infetch",
};

export default function UeberUnsPage() {
  return <PublicShell title="Über uns" />;
}
