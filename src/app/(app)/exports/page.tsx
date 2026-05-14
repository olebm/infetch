import { redirect } from "next/navigation";

// The automatic-forwarding queue is now visible in the "Versendet" tab of the Posteingang.
// The /exports route is repurposed as the user-facing download feature (see Einstellungen → Konto).
export default function ExportsPage() {
  redirect("/audit?tab=versendet");
}
