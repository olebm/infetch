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

// ── Kontakt-Formular ──────────────────────────────────────────────────────────

/**
 * Kontakt-Endpoint: 5 Nachrichten pro IP pro 10 Minuten.
 * Verhindert Spam/E-Mail-Abuse über /api/contact.
 */
export const contactIpLimiter = new InMemoryRateLimiter(5, 10 * 60_000);

/**
 * Globaler Deckel auf das Kontakt-Formular: 60 Nachrichten pro 10 Minuten
 * über alle IPs. Schützt vor verteilten Spam-Wellen (Brevo-Kontingent).
 */
export const contactGlobalLimiter = new InMemoryRateLimiter(60, 10 * 60_000);

// ── AI-Proxy (/api/ai/extract) ────────────────────────────────────────────────

/**
 * Globaler Deckel auf den AI-Proxy: 120 Extraktionen pro Minute.
 * Schützt das Mistral-Budget des Betreibers, falls das Bearer-Token leakt.
 */
export const aiProxyGlobalLimiter = new InMemoryRateLimiter(120, 60_000);

/**
 * Pro-IP-Limit auf den AI-Proxy: 20 Extraktionen pro Minute.
 * Verhindert, dass eine einzelne (kompromittierte) Quelle das Budget leerräumt.
 */
export const aiProxyIpLimiter = new InMemoryRateLimiter(20, 60_000);

// ── AI-Proxy org-scoped (INFETCH-165, tier-aware) ────────────────────────────

/**
 * Pro-Org-Limit (Free-Tier): max. 20 KI-Extraktionen pro Minute.
 * Free-Orgs haben ein niedrigeres Limit, da kein Zahlungsnachweis.
 */
export const aiProxyOrgFreeLimiter = new InMemoryRateLimiter(20, 60_000);

/**
 * Pro-Org-Limit (Pro/Business-Tier): max. 100 KI-Extraktionen pro Minute.
 * Zahlende Orgs bekommen 5× mehr Headroom für Batch-Imports.
 */
export const aiProxyOrgProLimiter = new InMemoryRateLimiter(100, 60_000);

// ── Globales API-Limit (Middleware) ───────────────────────────────────────────

/**
 * Per-IP-Deckel auf mutierende API-Requests: 100 pro Minute.
 * Grobmaschiger Schutz vor Scraping/Brute-Force/DoS; legitime Nutzung
 * bleibt deutlich darunter. Webhooks/Cron/AI/Inbound sind ausgenommen
 * (eigene Auth bzw. eigene Limiter).
 */
export const apiIpLimiter = new InMemoryRateLimiter(100, 60_000);

/** Client-IP aus Proxy-Headern ableiten (Coolify/Traefik setzt x-forwarded-for). */
export function clientIpFromHeaders(headers: Headers): string {
  const fwd = headers.get("x-forwarded-for");
  if (fwd) return fwd.split(",")[0].trim();
  return headers.get("x-real-ip")?.trim() || "unknown";
}
