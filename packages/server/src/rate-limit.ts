/**
 * Rate limiting middleware for the chat server.
 * Uses a sliding window counter per participant, stored in memory.
 */

export interface RateLimitConfig {
  /** Max requests per window. Default: 60 */
  maxRequests: number;
  /** Window size in milliseconds. Default: 60_000 (1 minute) */
  windowMs: number;
}

interface RateLimitEntry {
  timestamps: number[];
}

export class RateLimiter {
  private entries = new Map<string, RateLimitEntry>();
  private config: RateLimitConfig;
  private cleanupInterval: ReturnType<typeof setInterval>;

  constructor(config: Partial<RateLimitConfig> = {}) {
    this.config = {
      maxRequests: config.maxRequests ?? 60,
      windowMs: config.windowMs ?? 60_000,
    };
    // Periodic cleanup of stale entries
    this.cleanupInterval = setInterval(() => this.cleanup(), this.config.windowMs * 2);
  }

  /**
   * Check if a request should be allowed.
   * Returns { allowed, remaining, resetMs } where resetMs is ms until the oldest
   * request in the window expires.
   */
  check(key: string): { allowed: boolean; remaining: number; resetMs: number } {
    const now = Date.now();
    const windowStart = now - this.config.windowMs;

    let entry = this.entries.get(key);
    if (!entry) {
      entry = { timestamps: [] };
      this.entries.set(key, entry);
    }

    // Remove timestamps outside the window
    entry.timestamps = entry.timestamps.filter((t) => t > windowStart);

    const remaining = Math.max(0, this.config.maxRequests - entry.timestamps.length);
    const resetMs = entry.timestamps.length > 0
      ? entry.timestamps[0] + this.config.windowMs - now
      : this.config.windowMs;

    if (entry.timestamps.length >= this.config.maxRequests) {
      return { allowed: false, remaining: 0, resetMs };
    }

    entry.timestamps.push(now);
    return { allowed: true, remaining: remaining - 1, resetMs };
  }

  private cleanup() {
    const cutoff = Date.now() - this.config.windowMs;
    for (const [key, entry] of this.entries) {
      entry.timestamps = entry.timestamps.filter((t) => t > cutoff);
      if (entry.timestamps.length === 0) {
        this.entries.delete(key);
      }
    }
  }

  stop() {
    clearInterval(this.cleanupInterval);
  }
}

/**
 * Hono middleware factory for rate limiting.
 * Uses the participant ID as the rate limit key.
 */
export function rateLimitMiddleware(limiter: RateLimiter, skipPaths: string[] = []) {
  return async (c: any, next: () => Promise<void>) => {
    const path = new URL(c.req.url).pathname;
    if (skipPaths.some((p) => path.startsWith(p))) {
      await next();
      return;
    }

    const key = c.get("participantId") || c.req.header("X-Forwarded-For") || "anonymous";
    const { allowed, remaining, resetMs } = limiter.check(key);

    c.header("X-RateLimit-Remaining", String(remaining));
    c.header("X-RateLimit-Reset", String(Math.ceil(resetMs / 1000)));

    if (!allowed) {
      return c.json(
        { error: { code: "rate_limited", message: "Too many requests" } },
        429
      );
    }

    await next();
  };
}
