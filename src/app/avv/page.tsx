import type { Metadata } from "next";
import { PublicShell } from "@/components/layout/public-shell";
import { LEGAL_STAND, AVV_VERSION } from "@/lib/legal";

export const metadata: Metadata = {
  title: "AVV (DSGVO) — Infetch",
};

export default function AvvPage() {
  return (
    <PublicShell title="Auftragsverarbeitungsvertrag (AVV)">
      <p><strong>Auftragsverarbeiter:</strong> betaform | Ole Beekmann<br />
      <strong>Rechtsgrundlage:</strong> Art. 28 DSGVO<br />
      <strong>Abschluss:</strong> Click-through beim Akzeptieren der AGB<br />
      <strong>Version:</strong> {AVV_VERSION}<br />
      <strong>Stand:</strong> {LEGAL_STAND}</p>

      <hr />

      <p>Infetch verarbeitet im Rahmen seiner Dienstleistung E-Mails und Rechnungsdokumente seiner Kunden. Diese können personenbezogene Daten enthalten (z. B. Namen auf Rechnungen, E-Mail-Adressen von Rechnungsausstellern).</p>
      <p>Der Kunde bleibt dabei <strong>Verantwortlicher</strong> im Sinne der DSGVO; Infetch handelt als <strong>Auftragsverarbeiter</strong> (Art. 28 DSGVO). Dieser Vertrag wird durch Akzeptieren der AGB automatisch abgeschlossen. Die Seite dient als verbindlicher, abrufbarer Vertragstext.</p>

      <h2>1. Gegenstand und Dauer</h2>
      <p>(1) <strong>Gegenstand:</strong> Verarbeitung von E-Mail-Inhalten und Rechnungsdokumenten zur automatisierten Erkennung, Extraktion und Weiterleitung von Rechnungsdaten.</p>
      <p>(2) <strong>Dauer:</strong> Die Laufzeit des AVV entspricht der Laufzeit des Hauptvertrages (AGB) und endet automatisch mit Beendigung des Nutzungsvertrages.</p>

      <h2>2. Art und Zweck der Verarbeitung</h2>
      <p><strong>Art der Verarbeitung:</strong></p>
      <ul>
        <li>Temporärer Abruf von E-Mail-Inhalten verbundener Postfächer (IMAP) zur Rechnungserkennung</li>
        <li>Analyse und Extraktion strukturierter Daten aus erkannten Rechnungs-PDFs (KI-gestützt via Mistral AI)</li>
        <li>Dauerhafte Speicherung ausschließlich der als Rechnung erkannten Dokumente und der extrahierten Rechnungsfelder; übrige Postfachinhalte werden nicht dauerhaft gespeichert</li>
        <li>Übermittlung von Rechnungsdokumenten an vom Verantwortlichen konfigurierte Empfänger</li>
      </ul>
      <p><strong>Zweck:</strong> Erbringung der Infetch-SaaS-Leistung gemäß Hauptvertrag (AGB).</p>

      <h2>3. Art der personenbezogenen Daten</h2>
      <p>Verarbeitet werden ausschließlich Daten, die der Verantwortliche über verbundene Postfächer oder manuellen Upload bereitstellt. Typischerweise:</p>
      <ul>
        <li>Namen und Kontaktdaten auf Rechnungen (Rechnungsaussteller, ggf. Ansprechpartner)</li>
        <li>E-Mail-Adressen von Absendern</li>
        <li>Rechnungsbeträge, IBAN/Bankverbindungen auf Rechnungen</li>
        <li>Bestellnummern, Kundennummern</li>
      </ul>

      <h2>4. Kategorien betroffener Personen</h2>
      <ul>
        <li>Rechnungsaussteller (Unternehmen und deren Mitarbeiter)</li>
        <li>Mitarbeiter des Verantwortlichen, deren E-Mail-Postfächer verbunden sind</li>
      </ul>

      <h2>5. Pflichten von Infetch (Auftragsverarbeiter)</h2>
      <p>Infetch verpflichtet sich:</p>
      <p>(1) <strong>Weisungsgebundenheit:</strong> Daten ausschließlich auf dokumentierte Weisung des Verantwortlichen zu verarbeiten. Die Konfiguration durch den Kunden in der App gilt als Weisung.</p>
      <p>(2) <strong>Vertraulichkeit:</strong> Sicherzustellen, dass zur Verarbeitung befugte Personen zur Vertraulichkeit verpflichtet sind.</p>
      <p>(3) <strong>Technische und organisatorische Maßnahmen (TOMs)</strong> gemäß Art. 32 DSGVO — siehe Abschnitt 7.</p>
      <p>(4) <strong>Unterauftragsverarbeiter:</strong> Keine weiteren Unterauftragsverarbeiter ohne vorherige Information des Verantwortlichen einzusetzen (allgemeine Genehmigung mit Widerspruchsrecht, Abschnitt 8).</p>
      <p>(5) <strong>Unterstützung:</strong> Den Verantwortlichen bei der Erfüllung von Betroffenenrechten (Auskunft, Löschung, Einschränkung) zu unterstützen, soweit möglich.</p>
      <p>(6) <strong>Löschung:</strong> Nach Beendigung des Auftrags alle personenbezogenen Daten zu löschen oder zurückzugeben, sofern keine gesetzliche Aufbewahrungspflicht entgegensteht.</p>
      <p>(7) <strong>Nachweise:</strong> Dem Verantwortlichen alle erforderlichen Informationen zur Nachweisführung der Einhaltung dieses Vertrages bereitzustellen.</p>

      <h2>6. Pflichten des Verantwortlichen (Kunden)</h2>
      <p>(1) Der Verantwortliche stellt sicher, dass er zur Übermittlung der Daten an Infetch berechtigt ist.</p>
      <p>(2) Der Verantwortliche informiert Infetch unverzüglich, wenn er bei der Prüfung der Verarbeitungsvorgänge Fehler oder Unregelmäßigkeiten feststellt.</p>
      <p>(3) Weisungen werden schriftlich (E-Mail genügt) oder über die App-Konfiguration erteilt.</p>

      <h2>7. Technische und organisatorische Maßnahmen (TOMs)</h2>
      <div className="overflow-x-auto">
        <table>
          <thead><tr><th>Maßnahme</th><th>Umsetzung bei Infetch</th></tr></thead>
          <tbody>
            <tr><td>Verschlüsselung in Übertragung</td><td>TLS 1.2+ für alle Verbindungen</td></tr>
            <tr><td>Verschlüsselung im Ruhezustand</td><td>Datenbank-Verschlüsselung (Supabase/Hetzner AES-256); gespeicherte Rechnungs-PDFs und extrahierter Text zusätzlich anwendungsseitig AES-256-GCM-verschlüsselt</td></tr>
            <tr><td>Zugangskontrollen</td><td>Anmeldung per Einmal-Code an die E-Mail-Adresse (kein Passwort), rollenbasierte Berechtigungen</td></tr>
            <tr><td>Zugriffsprotokolle</td><td>Server-Logs, Sentry-Monitoring (anonymisiert)</td></tr>
            <tr><td>Datensicherung</td><td>Tägliche Backups, 7-Tage-Retention</td></tr>
            <tr><td>Incident Response</td><td>Meldung an Verantwortlichen bei Datenpanne innerhalb 72 h (hallo@infetch.de)</td></tr>
            <tr><td>Physische Sicherheit</td><td>Hetzner-Rechenzentrum (ISO 27001 zertifiziert), Frankfurt</td></tr>
          </tbody>
        </table>
      </div>

      <h2>8. Unterauftragsverarbeiter</h2>
      <p>Der Verantwortliche erteilt seine allgemeine Genehmigung für den Einsatz der folgenden Unterauftragsverarbeiter. Änderungen werden mindestens <strong>30 Tage</strong> im Voraus per E-Mail mitgeteilt.</p>
      <div className="overflow-x-auto">
        <table>
          <thead><tr><th>Dienstleister</th><th>Zweck</th><th>Standort</th><th>Zertifizierung</th></tr></thead>
          <tbody>
            <tr><td>Hetzner Online GmbH</td><td>Server-Hosting, Datenspeicherung</td><td>Deutschland (Frankfurt)</td><td>ISO 27001</td></tr>
            <tr><td>Supabase Inc.</td><td>Datenbank, Authentifizierung</td><td>US-Unternehmen; Datenhaltung EU (Frankfurt/AWS)</td><td>SOC 2 · EU-U.S. DPF / SCCs Art. 46 DSGVO</td></tr>
            <tr><td>Brevo SAS</td><td>Transaktionale E-Mails</td><td>Frankreich (EU)</td><td>ISO 27001</td></tr>
            <tr><td>Mistral AI SAS</td><td>KI-Textextraktion aus Rechnungen</td><td>Frankreich (EU)</td><td>Kein Training mit Kundendaten</td></tr>
            <tr><td>Sentry Inc.</td><td>Fehler-Monitoring (anonymisiert)</td><td>USA (SCCs gem. Art. 46 DSGVO)</td><td>SCCs</td></tr>
            <tr><td>Brandfetch</td><td>Anbieter-Logos (CDN; nur IP-Adresse beim Logo-Abruf)</td><td>Schweiz (Angemessenheitsbeschluss gem. Art. 45 DSGVO)</td><td>Angemessenheitsbeschluss</td></tr>
            <tr><td>Stripe Payments Europe Ltd.</td><td>Zahlungsabwicklung</td><td>Irland (EU)</td><td>PCI DSS</td></tr>
          </tbody>
        </table>
      </div>

      <h2>9. Datenpannen</h2>
      <p>Infetch meldet Verletzungen des Schutzes personenbezogener Daten unverzüglich, spätestens jedoch innerhalb von <strong>72 Stunden</strong> nach Bekanntwerden an den Verantwortlichen per E-Mail (an die E-Mail-Adresse des Kontos).</p>

      <h2>10. Schlussbestimmungen</h2>
      <p>Es gilt deutsches Recht. Dieser AVV ist Bestandteil des Hauptvertrages. Bei Widersprüchen zwischen AVV und AGB hat der AVV Vorrang in datenschutzrechtlichen Fragen.</p>
    </PublicShell>
  );
}
