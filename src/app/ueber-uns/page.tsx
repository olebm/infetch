import type { Metadata } from "next";
import { PublicShell } from "@/components/layout/public-shell";

export const metadata: Metadata = {
  title: "Über uns — Infetch",
};

export default function UeberUnsPage() {
  return (
    <PublicShell title="Über uns">
      <h2>Warum Infetch existiert</h2>
      <p>Buchhaltung ist kein Wettbewerbsvorteil — sie ist Pflicht. Trotzdem verbringen Selbstständige und kleine Teams jeden Monat Stunden damit, Rechnungen aus Postfächern zu fischen, manuell zu prüfen und weiterzuleiten. Infetch macht das automatisch, damit du dich um das kümmern kannst, was wirklich zählt.</p>
      <p>Wir glauben: Gute Software erledigt die lästigen Dinge zuverlässig im Hintergrund — und hält dich trotzdem in der Kontrolle.</p>

      <h2>Gründer</h2>
      <p><strong>Ole Beekmann</strong> · Gründer</p>
      <p>Infetch entsteht aus eigener Erfahrung mit dem monatlichen Rechnungs-Chaos — die Lösung, die ich mir selbst gewünscht hätte.</p>

      <h2>Fakten</h2>
      <div className="overflow-x-auto">
        <table>
          <tbody>
            <tr><td><strong>Sitz</strong></td><td>Hamburg, Deutschland</td></tr>
            <tr><td><strong>Serverstandort</strong></td><td>Frankfurt, Deutschland</td></tr>
          </tbody>
        </table>
      </div>

      <h2>Was uns wichtig ist</h2>
      <p><strong>EU-first, kein Kompromiss</strong><br />
      Alle Kerndaten liegen auf Servern in Deutschland. Wir nutzen keine US-Cloud für die Verarbeitung deiner Rechnungsinhalte. Mistral AI als KI-Backend sitzt in Frankreich — innerhalb der EU.</p>
      <p><strong>Automatisierung mit Kontrolle</strong><br />
      Infetch entscheidet nie alleine. Du siehst jede erkannte Rechnung, bevor sie weitergeleitet wird. Eingreifen ist immer möglich.</p>
      <p><strong>Kein Vendor Lock-in</strong><br />
      Deine Daten gehören dir. Export jederzeit, Kündigung ohne Aufwand — ohne Formulare, ohne Fristen außer dem laufenden Abrechnungszeitraum.</p>

      <h2>Kontakt</h2>
      <p>E-Mail: <a href="mailto:hallo@infetch.de">hallo@infetch.de</a></p>
    </PublicShell>
  );
}
