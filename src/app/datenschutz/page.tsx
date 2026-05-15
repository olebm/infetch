import type { Metadata } from "next";
import { PublicShell } from "@/components/layout/public-shell";

export const metadata: Metadata = {
  title: "Datenschutz — Infetch",
};

export default function DatenschutzPage() {
  return (
    <PublicShell title="Datenschutzerklärung">
      <p><strong>Verantwortlicher:</strong> betaform | Ole Beekmann · hallo@infetch.de<br />
      <strong>Rechtsgrundlage:</strong> Art. 13, 14 DSGVO<br />
      <strong>Stand:</strong> 15. Mai 2026</p>

      <hr />

      <h2>1. Verantwortlicher</h2>
      <p>
        <strong>betaform | Ole Beekmann</strong><br />
        Glindersweg 34, 21029 Hamburg<br />
        Deutschland<br />
        E-Mail: hallo@infetch.de
      </p>

      <h2>2. Welche Daten wir verarbeiten und warum</h2>

      <h3>2.1 Konto &amp; Authentifizierung</h3>
      <div className="overflow-x-auto">
        <table>
          <thead><tr><th>Daten</th><th>Zweck</th><th>Rechtsgrundlage</th><th>Dienstleister</th></tr></thead>
          <tbody>
            <tr><td>E-Mail-Adresse, Anmeldezeitpunkt, Session-Token</td><td>Zugang zur Anwendung</td><td>Art. 6 Abs. 1 lit. b DSGVO</td><td>Supabase Inc. (EU, Frankfurt)</td></tr>
          </tbody>
        </table>
      </div>

      <h3>2.2 Rechnungsverarbeitung</h3>
      <div className="overflow-x-auto">
        <table>
          <thead><tr><th>Daten</th><th>Zweck</th><th>Rechtsgrundlage</th><th>Hinweis</th></tr></thead>
          <tbody>
            <tr><td>E-Mail-Inhalte, PDF-Anhänge, extrahierte Felder (Anbieter, Betrag, Datum, Steuersatz)</td><td>Automatische Erkennung und Weiterleitung von Rechnungen</td><td>Art. 6 Abs. 1 lit. b DSGVO</td><td>Rechnungen können Namen natürlicher Personen enthalten. Diese werden ausschließlich zur Weiterleitung verarbeitet, nicht für andere Zwecke genutzt.</td></tr>
          </tbody>
        </table>
      </div>

      <h3>2.3 KI-Extraktion (Mistral AI)</h3>
      <div className="overflow-x-auto">
        <table>
          <thead><tr><th>Daten</th><th>Zweck</th><th>Dienstleister</th><th>Rechtsgrundlage</th></tr></thead>
          <tbody>
            <tr><td>Textinhalt von Rechnungs-PDFs (kein Layout, keine Bilder)</td><td>Strukturierte Extraktion von Rechnungsdaten (Anbieter, Betrag, Datum)</td><td>Mistral AI SAS, Paris (Frankreich, EU) — keine Nutzung für Modelltraining</td><td>Art. 6 Abs. 1 lit. b DSGVO</td></tr>
          </tbody>
        </table>
      </div>

      <h3>2.4 Zahlungsabwicklung</h3>
      <div className="overflow-x-auto">
        <table>
          <thead><tr><th>Daten</th><th>Zweck</th><th>Dienstleister</th><th>Rechtsgrundlage</th></tr></thead>
          <tbody>
            <tr><td>E-Mail-Adresse, Zahlungsmittel (direkt an Stripe übermittelt, nicht bei uns gespeichert)</td><td>Abonnementzahlungen</td><td>Stripe Payments Europe Ltd. (Irland, EU) — PCI DSS zertifiziert</td><td>Art. 6 Abs. 1 lit. b DSGVO</td></tr>
          </tbody>
        </table>
      </div>

      <h3>2.5 E-Mail-Benachrichtigungen</h3>
      <div className="overflow-x-auto">
        <table>
          <thead><tr><th>Daten</th><th>Zweck</th><th>Dienstleister</th><th>Rechtsgrundlage</th></tr></thead>
          <tbody>
            <tr><td>E-Mail-Adresse, Versandzeitpunkt</td><td>Systembenachrichtigungen (z. B. neue Rechnung erkannt)</td><td>Brevo SAS, Paris (Frankreich, EU) — ISO 27001</td><td>Art. 6 Abs. 1 lit. b DSGVO</td></tr>
          </tbody>
        </table>
      </div>

      <h3>2.6 Fehler-Monitoring</h3>
      <div className="overflow-x-auto">
        <table>
          <thead><tr><th>Daten</th><th>Zweck</th><th>Dienstleister</th><th>Rechtsgrundlage</th></tr></thead>
          <tbody>
            <tr><td>Anonymisierte Stack Traces, Browser-Typ, anonymisierte IP-Adresse</td><td>Technische Fehler erkennen und beheben</td><td>Sentry (USA) — Drittlandtransfer gem. Art. 46 DSGVO (SCCs)</td><td>Art. 6 Abs. 1 lit. f DSGVO (berechtigtes Interesse an Systemstabilität)</td></tr>
          </tbody>
        </table>
      </div>
      <p>Hinweis: Keine personenbezogenen Nutzerinhalte in Fehlerberichten. Der DPA mit Sentry (inkl. SCCs) ist einsehbar unter <a href="https://sentry.io/legal/dpa" target="_blank" rel="noopener noreferrer">sentry.io/legal/dpa</a>.</p>

      <h3>2.7 Hosting &amp; Infrastruktur</h3>
      <div className="overflow-x-auto">
        <table>
          <thead><tr><th>Dienstleister</th><th>Standort</th><th>Daten</th><th>Löschung</th></tr></thead>
          <tbody>
            <tr><td>Hetzner Online GmbH, Gunzenhausen</td><td>Deutschland (Frankfurt)</td><td>Alle App-Daten, Server-Logfiles (IP, Zeitstempel, HTTP-Status)</td><td>Server-Logs: 7 Tage</td></tr>
          </tbody>
        </table>
      </div>

      <h3>2.8 Logos (Brandfetch CDN)</h3>
      <p>Beim Laden von Anbieterlogos werden Anfragen an cdn.brandfetch.io gestellt. Dabei kann deine IP-Adresse an Brandfetch Inc. (USA) übertragen werden.</p>
      <p>Rechtsgrundlage: Art. 6 Abs. 1 lit. f DSGVO (berechtigtes Interesse an der Darstellungsfunktionalität).</p>

      <h2>3. Cookies und Speicher</h2>
      <p>Wir verwenden <strong>keine Tracking- oder Werbe-Cookies</strong>. Ein Cookie-Consent-Banner ist nicht erforderlich, da ausschließlich technisch notwendige Cookies eingesetzt werden.</p>
      <div className="overflow-x-auto">
        <table>
          <thead><tr><th>Cookie</th><th>Zweck</th><th>Laufzeit</th></tr></thead>
          <tbody>
            <tr><td><code>sb-*</code> (Supabase)</td><td>Authentifizierungs-Session</td><td>Session / 1 Woche</td></tr>
          </tbody>
        </table>
      </div>

      <h2>4. Speicherdauer und Löschung</h2>
      <div className="overflow-x-auto">
        <table>
          <thead><tr><th>Datenkategorie</th><th>Löschfrist</th></tr></thead>
          <tbody>
            <tr><td>Kontodaten</td><td>Mit Kündigung des Kontos</td></tr>
            <tr><td>Rechnungen &amp; Dateien</td><td>Mit Kündigung des Kontos oder auf Anfrage</td></tr>
            <tr><td>Server-Logs</td><td>7 Tage</td></tr>
            <tr><td>Zahlungsdaten bei Stripe</td><td>Gemäß Stripe-Datenschutzrichtlinie (handelsrechtliche Aufbewahrungspflicht bis zu 10 Jahre)</td></tr>
          </tbody>
        </table>
      </div>

      <h2>5. Weitergabe an Dritte</h2>
      <p>Deine Daten werden nicht verkauft. Weitergabe erfolgt ausschließlich an die oben genannten Auftragsverarbeiter, die vertraglich zur Einhaltung der DSGVO verpflichtet sind (<a href="/avv">→ AVV</a>).</p>

      <h2>6. Deine Rechte</h2>
      <p>Du hast gegenüber uns folgende Rechte:</p>
      <ul>
        <li><strong>Auskunft</strong> (Art. 15 DSGVO): Welche Daten wir über dich haben</li>
        <li><strong>Berichtigung</strong> (Art. 16 DSGVO): Korrektur unrichtiger Daten</li>
        <li><strong>Löschung</strong> (Art. 17 DSGVO): Recht auf Vergessenwerden</li>
        <li><strong>Einschränkung</strong> (Art. 18 DSGVO): Verarbeitung einschränken lassen</li>
        <li><strong>Datenportabilität</strong> (Art. 20 DSGVO): Daten in maschinenlesbarem Format</li>
        <li><strong>Widerspruch</strong> (Art. 21 DSGVO): Gegen Verarbeitung auf Basis berechtigter Interessen</li>
        <li><strong>Beschwerde</strong> bei einer Aufsichtsbehörde — zuständig ist der <a href="https://www.datenschutz.hamburg.de" target="_blank" rel="noopener noreferrer">Hamburgische Beauftragte für Datenschutz und Informationsfreiheit (HmbBfDI)</a></li>
      </ul>
      <p>Anfragen bitte an: <a href="mailto:hallo@infetch.de">hallo@infetch.de</a></p>

      <h2>7. Auftragsverarbeitung</h2>
      <p>Soweit wir Daten im Auftrag unserer Kunden verarbeiten, geschieht dies auf Grundlage eines Auftragsverarbeitungsvertrages (AVV) nach Art. 28 DSGVO.<br />
      <a href="/avv">→ AVV einsehen</a></p>

      <h2>8. Änderungen dieser Erklärung</h2>
      <p>Wir können diese Datenschutzerklärung bei wesentlichen Änderungen unserer Dienste aktualisieren. Das Datum der letzten Änderung ist oben angegeben.</p>
    </PublicShell>
  );
}
