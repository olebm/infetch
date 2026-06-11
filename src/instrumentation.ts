import * as Sentry from "@sentry/nextjs";

export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    // Sentry: muss vor allem anderen registriert werden damit Startup-Fehler
    // ebenfalls erfasst werden. Kein-op wenn SENTRY_DSN nicht gesetzt.
    await import("@/lib/sentry/server-config");

    const { startAutoPilot } = await import("@/lib/auto-pilot");
    startAutoPilot();
  }
}

// Request-/RSC-Fehler (Next-Logzeilen mit digest) an Sentry melden. Ohne diesen
// Hook erreichen Server-Render-Fehler GlitchTip nicht (INFETCH-276: der
// 5-Minuten-TypeError war deshalb dort unsichtbar). Kein-op ohne SENTRY_DSN.
export const onRequestError = Sentry.captureRequestError;
