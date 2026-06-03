/**
 * Generischer Retry-Helper mit exponentiellem Backoff + Jitter.
 *
 * Gedacht für transiente Fehler externer Dienste (HTTP 429/5xx, Timeouts,
 * Netzwerk-Resets). Nicht-retrybare Fehler (4xx außer 429/408, Validierung)
 * werden sofort weitergeworfen.
 */

export type RetryOptions = {
  /** Max. zusätzliche Versuche nach dem ersten (Default: 3). */
  retries?: number;
  /** Basis-Delay in ms für Backoff (Default: 500). */
  baseDelayMs?: number;
  /** Obergrenze des Delays in ms (Default: 8000). */
  maxDelayMs?: number;
  /** Entscheidet, ob ein Fehler einen Retry auslöst. */
  isRetryable?: (err: unknown) => boolean;
  /** Callback vor jedem Retry (z. B. Logging). */
  onRetry?: (err: unknown, attempt: number) => void;
};

/** Marker-Fehler für retrybare HTTP-Statuscodes (von Fetch-Wrappern genutzt). */
export class TransientHttpError extends Error {
  constructor(public readonly status: number) {
    super(`Transient HTTP status ${status}`);
    this.name = "TransientHttpError";
  }
}

export function isRetryableHttpStatus(status: number): boolean {
  return status === 408 || status === 429 || (status >= 500 && status <= 599);
}

export function isNetworkError(err: unknown): boolean {
  if (!(err instanceof Error)) return false;
  const name = err.name;
  if (name === "AbortError" || name === "TypeError" || name === "FetchError") return true;
  const msg = err.message.toLowerCase();
  return (
    msg.includes("timeout") ||
    msg.includes("network") ||
    msg.includes("econnreset") ||
    msg.includes("socket hang up") ||
    msg.includes("und_err") ||
    msg.includes("fetch failed")
  );
}

export function defaultIsRetryable(err: unknown): boolean {
  if (err instanceof TransientHttpError) return true;
  if (isNetworkError(err)) return true;
  const status =
    (err as { statusCode?: number })?.statusCode ?? (err as { status?: number })?.status;
  if (typeof status === "number") return isRetryableHttpStatus(status);
  return false;
}

export async function withRetry<T>(fn: () => Promise<T>, opts: RetryOptions = {}): Promise<T> {
  const retries = opts.retries ?? 3;
  const base = opts.baseDelayMs ?? 500;
  const max = opts.maxDelayMs ?? 8000;
  const isRetryable = opts.isRetryable ?? defaultIsRetryable;

  let attempt = 0;
  for (;;) {
    try {
      return await fn();
    } catch (err) {
      attempt += 1;
      if (attempt > retries || !isRetryable(err)) throw err;
      const backoff = Math.min(max, base * 2 ** (attempt - 1));
      const jitter = Math.random() * Math.min(250, backoff);
      opts.onRetry?.(err, attempt);
      await new Promise((resolve) => setTimeout(resolve, backoff + jitter));
    }
  }
}
