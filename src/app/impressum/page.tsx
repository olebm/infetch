import type { Metadata } from "next";
import { PublicShell } from "@/components/layout/public-shell";

export const metadata: Metadata = {
  title: "Impressum — Infetch",
};

export default function ImpressumPage() {
  return (
    <PublicShell title="Impressum">
      <p><strong>Rechtsgrundlage:</strong> § 5 DDG · § 18 Abs. 2 MStV<br />
      <strong>Betreiber:</strong> betaform | Ole Beekmann<br />
      <strong>Stand:</strong> 15. Mai 2026</p>

      <hr />

      <h2>Angaben gemäß § 5 DDG</h2>
      <p>
        <strong>betaform | Ole Beekmann</strong><br />
        Glindersweg 34<br />
        21029 Hamburg<br />
        Deutschland
      </p>
      <p><strong>Vertreten durch:</strong> Ole Beekmann</p>

      <h2>Kontakt</h2>
      <p>
        Telefon: <a href="tel:+4917723110041">+49 177 23 11 04 1</a><br />
        E-Mail: <a href="mailto:hallo@infetch.de">hallo@infetch.de</a>
      </p>

      <h2>Umsatzsteuer-Identifikationsnummer</h2>
      <p>Gemäß § 27a Umsatzsteuergesetz:<br />
      DE318609562</p>

      <h2>Streitschlichtung</h2>
      <p>Die Europäische Kommission stellt eine Plattform zur Online-Streitbeilegung (OS) bereit:<br />
      <a href="https://ec.europa.eu/consumers/odr/" target="_blank" rel="noopener noreferrer">https://ec.europa.eu/consumers/odr/</a></p>
      <p>Wir sind nicht bereit und nicht verpflichtet, an Streitbeilegungsverfahren vor einer Verbraucherschlichtungsstelle teilzunehmen.</p>
    </PublicShell>
  );
}
