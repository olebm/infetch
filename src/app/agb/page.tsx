import type { Metadata } from "next";
import { PublicShell } from "@/components/layout/public-shell";

export const metadata: Metadata = {
  title: "AGB — Infetch",
};

export default function AgbPage() {
  return (
    <PublicShell title="Allgemeine Geschäftsbedingungen">
      <p><strong>Betreiber:</strong> betaform | Ole Beekmann · hallo@infetch.de<br />
      <strong>Plattform:</strong> infetch.de<br />
      <strong>Rechtsgrundlage:</strong> §§ 305 ff. BGB<br />
      <strong>Stand:</strong> 14. Mai 2025</p>

      <hr />

      <h2>§ 1 Geltungsbereich</h2>
      <p>Diese Allgemeinen Geschäftsbedingungen gelten für alle Verträge zwischen <strong>betaform | Ole Beekmann</strong>, Hamburg (nachfolgend „Infetch“), und ihren Kunden (nachfolgend „Nutzer“) über die Nutzung der Software-as-a-Service-Plattform Infetch unter infetch.de.</p>
      <p>Entgegenstehende oder abweichende Bedingungen des Nutzers werden nicht anerkannt, es sei denn, Infetch hat deren Geltung ausdrücklich schriftlich zugestimmt.</p>

      <h2>§ 2 Leistungsbeschreibung</h2>
      <p>Infetch ist eine webbasierte Software-as-a-Service-Lösung (SaaS), die folgende Kernfunktionen bereitstellt:</p>
      <ul>
        <li>Automatisierter Abruf von Rechnungsdokumenten aus verbundenen E-Mail-Postfächern (IMAP)</li>
        <li>KI-gestützte Extraktion von Rechnungsdaten (Anbieter, Betrag, Datum, Steuersatz) mithilfe von Mistral AI</li>
        <li>Weiterleitung von Rechnungen an vom Nutzer konfigurierte Empfänger oder Buchhaltungstools</li>
        <li>Bereitstellung einer Übersichtsoberfläche zur Verwaltung und Prüfung erkannter Rechnungen</li>
      </ul>
      <p>Aktuelle Funktionen der einzelnen Tarifpläne sind der Preisseite unter infetch.de zu entnehmen. Infetch behält sich vor, den Leistungsumfang der Pläne zu ändern, soweit dies dem Nutzer zumutbar ist.</p>

      <h2>§ 3 Vertragsschluss und Laufzeit</h2>
      <p>(1) Der Vertrag kommt durch Registrierung auf infetch.de und Bestätigung dieser AGB zustande.</p>
      <p>(2) Der <strong>Free-Plan</strong> ist kostenlos und auf unbestimmte Zeit verfügbar.</p>
      <p>(3) <strong>Kostenpflichtige Pläne</strong> (Pro, Business) beginnen mit Abschluss des Abonnements über Stripe und laufen monatlich. Die Laufzeit verlängert sich automatisch um jeweils einen Monat, sofern nicht gekündigt wird.</p>
      <p>(4) Der Nutzer kann kostenpflichtige Abonnements jederzeit zum Ende des laufenden Abrechnungszeitraums kündigen. Die Kündigung erfolgt über das Abrechnungsportal in den Kontoeinstellungen.</p>
      <p>(5) Infetch kann Free-Plan-Nutzern mit einer Frist von 30 Tagen den kostenlosen Zugang beenden.</p>

      <h2>§ 4 Preise und Zahlung</h2>
      <p>(1) Die jeweils aktuellen Preise sind auf der Preisseite unter infetch.de ausgewiesen.</p>
      <p>(2) Die Abrechnung kostenpflichtiger Pläne erfolgt monatlich im Voraus über den Zahlungsdienstleister <strong>Stripe</strong>. Maßgeblich sind die Preise zum Zeitpunkt des Abonnementabschlusses.</p>
      <p>(3) Alle Preise verstehen sich zuzüglich der gesetzlichen Umsatzsteuer.</p>
      <p>(4) Bei Zahlungsverzug ist Infetch berechtigt, den Zugang zu kostenpflichtigen Funktionen zu sperren, bis der ausstehende Betrag beglichen ist.</p>

      <h2>§ 5 Widerrufsrecht (Verbraucher)</h2>
      <blockquote>
        <strong>Gilt nur für Verbraucher im Sinne des § 13 BGB</strong> — natürliche Personen, die Infetch außerhalb ihrer gewerblichen oder selbstständigen beruflichen Tätigkeit nutzen.
      </blockquote>
      <p>(1) Verbrauchern steht ein gesetzliches Widerrufsrecht zu. Die Widerrufsfrist beträgt <strong>14 Tage</strong> ab Vertragsschluss.</p>
      <p>(2) Um das Widerrufsrecht auszuüben, muss der Verbraucher uns (betaform | Ole Beekmann, hallo@infetch.de) mittels einer eindeutigen Erklärung (z. B. per E-Mail) über den Entschluss informieren, diesen Vertrag zu widerrufen.</p>
      <p>(3) Zur Wahrung der Widerrufsfrist genügt die rechtzeitige Absendung der Widerrufserklärung vor Ablauf der Frist.</p>
      <p><strong>Muster-Widerrufsformular:</strong></p>
      <blockquote>
        An: betaform | Ole Beekmann, hallo@infetch.de<br />
        Hiermit widerrufe(n) ich/wir den von mir/uns abgeschlossenen Vertrag über die Nutzung von Infetch.<br />
        Vertragsschluss am: [Datum]<br />
        Name: [Name]<br />
        Datum: [Datum]
      </blockquote>
      <p>(4) Das Widerrufsrecht erlischt vorzeitig, wenn der Nutzer ausdrücklich zugestimmt hat, dass mit der Ausführung des Vertrages vor Ablauf der Widerrufsfrist begonnen wird, und er bestätigt hat, dass er dadurch sein Widerrufsrecht verliert.</p>

      <h2>§ 6 Pflichten des Nutzers</h2>
      <p>(1) Der Nutzer ist verpflichtet, bei der Registrierung korrekte und vollständige Angaben zu machen und diese aktuell zu halten.</p>
      <p>(2) Der Nutzer ist für die Sicherheit seiner Zugangsdaten verantwortlich und hat unbefugte Zugriffe unverzüglich zu melden.</p>
      <p>(3) Der Nutzer darf Infetch ausschließlich für rechtmäßige Zwecke nutzen. Verboten ist insbesondere:</p>
      <ul>
        <li>das Hochladen oder Verarbeiten illegal erlangter Dokumente</li>
        <li>automatisierte Massenanfragen, die den Betrieb beeinträchtigen</li>
        <li>der Versuch, Sicherheitsmechanismen zu umgehen</li>
      </ul>
      <p>(4) Der Nutzer stellt sicher, dass er die Berechtigung besitzt, die verbundenen E-Mail-Postfächer und Rechnungsdokumente über Infetch verarbeiten zu lassen, und hat gegenüber betroffenen Dritten die erforderlichen datenschutzrechtlichen Pflichten erfüllt.</p>

      <h2>§ 7 Datenschutz und Auftragsverarbeitung</h2>
      <p>(1) Die Verarbeitung personenbezogener Daten durch Infetch erfolgt gemäß der Datenschutzerklärung unter infetch.de/datenschutz.</p>
      <p>(2) Soweit Infetch personenbezogene Daten im Auftrag des Nutzers verarbeitet, gilt der Auftragsverarbeitungsvertrag (AVV) unter infetch.de/avv als vereinbart. Durch Akzeptieren dieser AGB stimmt der Nutzer dem AVV zu.</p>

      <h2>§ 8 Verfügbarkeit</h2>
      <p>(1) Infetch strebt eine Verfügbarkeit der Plattform von 99 % im Jahresdurchschnitt an (Best Effort). Ein Rechtsanspruch auf eine bestimmte Verfügbarkeit besteht nicht.</p>
      <p>(2) Geplante Wartungsarbeiten werden nach Möglichkeit vorab angekündigt und außerhalb der Hauptnutzungszeiten durchgeführt.</p>

      <h2>§ 9 Haftung</h2>
      <p>(1) Infetch haftet uneingeschränkt für Schäden aus der Verletzung des Lebens, des Körpers oder der Gesundheit sowie für vorsätzliches oder grob fahrlässiges Verhalten.</p>
      <p>(2) Bei einfacher Fahrlässigkeit haftet Infetch nur für die Verletzung wesentlicher Vertragspflichten (Kardinalpflichten). Die Haftung ist auf den vorhersehbaren, vertragstypischen Schaden begrenzt.</p>
      <p>(3) Für den Verlust von Daten haftet Infetch nur, soweit der Nutzer zumutbare Datensicherungsmaßnahmen getroffen hat.</p>
      <p>(4) Eine Haftung für Schäden, die dadurch entstehen, dass Rechnungen nicht oder fehlerhaft erkannt werden, ist ausgeschlossen, sofern Infetch die im Verkehr erforderliche Sorgfalt eingehalten hat.</p>

      <h2>§ 10 Geistiges Eigentum</h2>
      <p>Alle Rechte an der Infetch-Plattform (Software, Design, Marke) verbleiben bei Infetch. Dem Nutzer wird ein einfaches, nicht übertragbares Nutzungsrecht für die Dauer des Vertragsverhältnisses eingeräumt.</p>

      <h2>§ 11 Änderungen der AGB</h2>
      <p>(1) Infetch behält sich vor, diese AGB mit einer Ankündigungsfrist von <strong>4 Wochen</strong> zu ändern. Die Änderung wird dem Nutzer per E-Mail mitgeteilt.</p>
      <p>(2) Widerspricht der Nutzer nicht innerhalb von 4 Wochen nach Zugang der Änderungsmitteilung, gelten die neuen AGB als akzeptiert. Auf diese Folge wird in der Mitteilung gesondert hingewiesen.</p>
      <p>(3) Bei wesentlichen Änderungen, die Verbraucher benachteiligen könnten, wird gesondert auf das Widerspruchsrecht hingewiesen.</p>

      <h2>§ 12 Anwendbares Recht und Gerichtsstand</h2>
      <p>(1) Es gilt das Recht der Bundesrepublik Deutschland unter Ausschluss des UN-Kaufrechts (CISG).</p>
      <p>(2) Gerichtsstand für alle Streitigkeiten aus diesem Vertrag ist <strong>Hamburg</strong>, sofern der Nutzer Kaufmann, juristische Person des öffentlichen Rechts oder öffentlich-rechtliches Sondervermögen ist.</p>
      <p>(3) Für Verbraucher gilt der gesetzliche Gerichtsstand.</p>

      <h2>§ 13 Schlussbestimmungen</h2>
      <p>Sollten einzelne Bestimmungen dieser AGB unwirksam sein, berührt dies die Wirksamkeit der übrigen Bestimmungen nicht.</p>
    </PublicShell>
  );
}
