/**
 * Sentry Server-Side Konfiguration.
 *
 * Wird via instrumentation.ts registriert (NEXT_RUNTIME === "nodejs").
 * Kein Client-SDK — Invoice-Daten im Browser-State bleiben lokal.
 *
 * DSN via Env-Variable SENTRY_DSN setzen.
 * Wenn leer → Sentry bleibt deaktiviert (kein Tracking bei Self-Hostern).
 *
 * EU-Endpoint: DSN beim Erstellen des Sentry-Projekts auf Region "EU" setzen
 * (ingest.eu.sentry.io) — dann stimmt der Endpoint automatisch.
 */

import * as Sentry from "@sentry/nextjs";
import { scrubSentryEvent } from "@/lib/sentry/scrubber";

const dsn = process.env.SENTRY_DSN?.trim() || undefined;
const isProduction = process.env.NODE_ENV === "production";

Sentry.init({
  dsn,

  // Nur in production + wenn DSN gesetzt
  enabled: isProduction && Boolean(dsn),

  // Kein Performance-Tracing — wir wollen nur Fehler
  tracesSampleRate: 0,

  // Kein Session-Replay (server-side irrelevant, aber sicherheitshalber)
  replaysSessionSampleRate: 0,
  replaysOnErrorSampleRate: 0,

  // PII-Scrubber — läuft vor jedem Upload
  // Gibt null zurück wenn kein DSN → Event wird verworfen
  beforeSend: dsn ? scrubSentryEvent : () => null,

  // Breadcrumbs deaktivieren — wir brauchen keine Navigate/Click-History
  integrations(integrations) {
    return integrations.filter((i) => !["Breadcrumbs", "GlobalHandlers"].includes(i.name));
  },
});
