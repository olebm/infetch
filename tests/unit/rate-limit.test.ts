import { describe, expect, it } from "vitest";
import { InMemoryRateLimiter, clientIpFromHeaders } from "@/lib/rate-limit";

describe("clientIpFromHeaders", () => {
  it("nimmt die erste IP aus x-forwarded-for", () => {
    const h = new Headers({ "x-forwarded-for": "203.0.113.7, 10.0.0.1, 10.0.0.2" });
    expect(clientIpFromHeaders(h)).toBe("203.0.113.7");
  });

  it("trimmt Whitespace in x-forwarded-for", () => {
    const h = new Headers({ "x-forwarded-for": "  198.51.100.4  " });
    expect(clientIpFromHeaders(h)).toBe("198.51.100.4");
  });

  it("fällt auf x-real-ip zurück", () => {
    const h = new Headers({ "x-real-ip": "192.0.2.55" });
    expect(clientIpFromHeaders(h)).toBe("192.0.2.55");
  });

  it("gibt 'unknown' zurück wenn keine Proxy-Header gesetzt sind", () => {
    expect(clientIpFromHeaders(new Headers())).toBe("unknown");
  });

  it("bündelt alle Header-losen Clients auf denselben Bucket (kein Bypass)", () => {
    // Wichtig: 'unknown' darf nicht pro Request neu erzeugt werden, sonst
    // umgeht ein Angreifer ohne XFF-Header das Limit komplett.
    expect(clientIpFromHeaders(new Headers())).toBe(clientIpFromHeaders(new Headers()));
  });
});

describe("InMemoryRateLimiter", () => {
  it("erlaubt Requests unter dem Limit", () => {
    const limiter = new InMemoryRateLimiter(5, 60_000);
    const result = limiter.check("key-a");
    expect(result.ok).toBe(true);
    expect(result.remaining).toBe(4);
  });

  it("zählt Requests korrekt hoch", () => {
    const limiter = new InMemoryRateLimiter(3, 60_000);
    expect(limiter.check("key").remaining).toBe(2);
    expect(limiter.check("key").remaining).toBe(1);
    expect(limiter.check("key").remaining).toBe(0);
  });

  it("blockiert bei Überschreitung des Limits", () => {
    const limiter = new InMemoryRateLimiter(2, 60_000);
    limiter.check("key");
    limiter.check("key");
    const blocked = limiter.check("key");
    expect(blocked.ok).toBe(false);
    expect(blocked.remaining).toBe(0);
  });

  it("setzt Counter nach Ablauf des Fensters zurück", () => {
    // Fenster von 1 ms — läuft sofort ab
    const limiter = new InMemoryRateLimiter(1, 1);
    limiter.check("key"); // verbraucht Limit

    // Kurz warten bis Fenster abläuft
    return new Promise<void>((resolve) => {
      setTimeout(() => {
        const result = limiter.check("key");
        expect(result.ok).toBe(true); // neues Fenster
        resolve();
      }, 5);
    });
  });

  it("behandelt verschiedene Keys unabhängig", () => {
    const limiter = new InMemoryRateLimiter(1, 60_000);
    const a = limiter.check("key-a");
    const b = limiter.check("key-b");
    expect(a.ok).toBe(true);
    expect(b.ok).toBe(true);

    // key-a ist jetzt voll, key-b auch
    expect(limiter.check("key-a").ok).toBe(false);
    expect(limiter.check("key-b").ok).toBe(false);
  });

  it("gibt resetAt als zukünftigen Timestamp zurück", () => {
    const limiter = new InMemoryRateLimiter(5, 60_000);
    const before = Date.now();
    const result = limiter.check("key");
    expect(result.resetAt).toBeGreaterThan(before);
    expect(result.resetAt).toBeLessThanOrEqual(before + 60_000 + 10);
  });

  it("remaining sinkt bei jedem Request um 1", () => {
    const limiter = new InMemoryRateLimiter(5, 60_000);
    for (let i = 4; i >= 0; i--) {
      const result = limiter.check("key");
      expect(result.remaining).toBe(i);
    }
  });

  it("Limit=1: erster Request erlaubt, zweiter blockiert", () => {
    const limiter = new InMemoryRateLimiter(1, 60_000);
    expect(limiter.check("key").ok).toBe(true);
    expect(limiter.check("key").ok).toBe(false);
  });
});
