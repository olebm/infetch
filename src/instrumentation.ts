export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    // Sentry: muss vor allem anderen registriert werden damit Startup-Fehler
    // ebenfalls erfasst werden. Kein-op wenn SENTRY_DSN nicht gesetzt.
    await import("@/lib/sentry/server-config");

    const { startAutoPilot } = await import("@/lib/auto-pilot");
    startAutoPilot();
  }
}
