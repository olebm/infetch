import type { Metadata } from "next";
import { PublicShell } from "@/components/layout/public-shell";

export const metadata: Metadata = {
  title: "Changelog — Infetch",
};

export default function ChangelogPage() {
  return <PublicShell title="Changelog" />;
}
