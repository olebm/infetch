import type { Metadata } from "next";
import { PublicShell } from "@/components/layout/public-shell";

export const metadata: Metadata = {
  title: "Impressum — Infetch",
};

export default function ImpressumPage() {
  return (
    <PublicShell title="Impressum">
      <p><strong>Rechtsgrundlage:</strong> § 5 TMG · § 55 RStV<br />
      <strong>Betreiber:</strong> betaform | Ole Beekmann<br />
      <strong>Stand:</strong> 14. Mai 2025</p>

      <hr />

      <h2>Angaben gemäß § 5 TMG</h2>
      <p>
        <strong>betaform | Ole Beekmann</strong><br />
        [Straße und Hausnummer]<br />
        [PLZ] Hamburg<br />
        Deutschland
      </p>
      <p><strong>Vertreten durch:</strong> Ole Beekmann</p>

      <h2>Kontakt</h2>
      <p>
        E-Mail: <a href="mailto:hallo@infetch.de">hallo@infetch.de</a>
      </p>

      <h2>Hinweis zur Unternehmensform</h2>
      <p>Infetch wird derzeit als Einzelunternehmen unter dem Namen <strong>betaform | Ole Beekmann</strong> betrieben. Eine Umwandlung in eine GmbH ist geplant. Das Impressum wird nach erfolgter Handelsregistereintragung entsprechend aktualisiert.</p>

      <h2>Umsatzsteuer-Identifikationsnummer</h2>
      <p>Gemäß § 27a Umsatzsteuergesetz:<br />
      DE[Nummer] — beantragt beim Finanzamt Hamburg</p>

      <h2>Streitschlichtung</h2>
      <p>Die Europäische Kommission stellt eine Plattform zur Online-Streitbeilegung (OS) bereit:<br />
      <a href="https://ec.europa.eu/consumers/odr/" target="_blank" rel="noopener noreferrer">https://ec.europa.eu/consumers/odr/</a></p>
      <p>Wir sind nicht bereit und nicht verpflichtet, an Streitbeilegungsverfahren vor einer Verbraucherschlichtungsstelle teilzunehmen.</p>
    </PublicShell>
  );
}
