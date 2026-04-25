/**
 * Simple in-memory token-bucket rate limiter.
 *
 * Designed for single-instance deployments (this app runs as one Next.js
 * process behind Basic Auth). For multi-instance you'd want Upstash/Redis.
 */

type Bucket = { tokens: number; updatedAt: number };

const buckets = new Map<string, Bucket>();

export interface RateLimitOptions {
  /** Max requests allowed in the window */
  capacity: number;
  /** Window length in milliseconds */
  windowMs: number;
}

/**
 * Check + decrement a token bucket keyed by `key` (typically `route:ip`).
 * Returns `{ allowed: true }` if the request fits within the budget,
 * `{ allowed: false, retryAfterMs }` otherwise.
 */
export function rateLimit(
  key: string,
  opts: RateLimitOptions,
): { allowed: true } | { allowed: false; retryAfterMs: number } {
  const now = Date.now();
  const refillRate = opts.capacity / opts.windowMs; // tokens per ms
  const existing = buckets.get(key);

  if (!existing) {
    buckets.set(key, { tokens: opts.capacity - 1, updatedAt: now });
    return { allowed: true };
  }

  const elapsed = now - existing.updatedAt;
  const refilled = Math.min(opts.capacity, existing.tokens + elapsed * refillRate);

  if (refilled < 1) {
    const retryAfterMs = Math.ceil((1 - refilled) / refillRate);
    existing.tokens = refilled;
    existing.updatedAt = now;
    return { allowed: false, retryAfterMs };
  }

  existing.tokens = refilled - 1;
  existing.updatedAt = now;
  return { allowed: true };
}

/** Pull a stable client identifier from the request — IP-based, behind any proxy. */
export function clientKey(req: Request, route: string): string {
  const xff = req.headers.get("x-forwarded-for");
  const ip = xff?.split(",")[0].trim() || req.headers.get("x-real-ip") || "unknown";
  return `${route}:${ip}`;
}

/** Test-only: clear all buckets between runs */
export function _resetRateLimits(): void {
  buckets.clear();
}
