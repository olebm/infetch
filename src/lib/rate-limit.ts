/**
 * Leichtgewichtiger In-Memory Rate-Limiter (INFETCH-94).
 *
 * Annahmen:
 * - Single-Instance-Deployment (Coolify, kein Cluster)
 * - Counter leben nur in diesem Prozess — Reset bei Neustart, akzeptabel
 * - Fixes Fenster (kein Sliding-Window) — einfach und für Webhook-Schutz ausreichend
 *
 * Für Multi-Instance-Setups später durch Upstash-Redis-Variante austauschbar.
 */

interface Window {
  count: number;
  resetAt: number; // Unix-Timestamp in ms
}

export class InMemoryRateLimiter {
  private readonly windows = new Map<string, Window>();

  constructor(
    private readonly limit: number,
    private readonly windowMs: number,
  ) {
    // Veraltete Map-Einträge alle 5 Minuten aufräumen (verhindert Memory-Leak)
    const timer = setInterval(() => this.cleanup(), 5 * 60_000);
    // Node.js: Timer soll Prozess-Exit nicht blockieren
    timer.unref?.();
  }

  /**
   * Prüft und inkrementiert den Counter für `key`.
   * Gibt { ok, remaining, resetAt } zurück.
   */
  check(key: string): { ok: boolean; remaining: number; resetAt: number } {
    const now = Date.now();
    let win = this.windows.get(key);

    // Neues oder abgelaufenes Fenster → frisch starten
    if (!win || win.resetAt <= now) {
      win = { count: 1, resetAt: now + this.windowMs };
      this.windows.set(key, win);
      return { ok: true, remaining: this.limit - 1, resetAt: win.resetAt };
    }

    // Limit überschritten
    if (win.count >= this.limit) {
      return { ok: false, remaining: 0, resetAt: win.resetAt };
    }

    win.count++;
    return { ok: true, remaining: this.limit - win.count, resetAt: win.resetAt };
  }

  private cleanup(): void {
    const now = Date.now();
    for (const [key, win] of this.windows) {
      if (win.resetAt <= now) this.windows.delete(key);
    }
  }
}

// ── Singleton-Instanzen für /api/inbound/mail ─────────────────────────────────

/**
 * Globales Limit: max. 60 authentifizierte Requests pro 60 Sekunden.
 * Schützt vor misconfig beim Mail-Relay (Feedback-Loop) und KI-Budget-Inflation.
 */
export const inboundGlobalLimiter = new InMemoryRateLimiter(60, 60_000);

/**
 * Pro-IP-Limit: max. 10 Requests pro 60 Sekunden per Quell-IP.
 * Verhindert, dass eine einzige Quelle das globale Limit alleine ausschöpft.
 */
export const inboundIpLimiter = new InMemoryRateLimiter(10, 60_000);
