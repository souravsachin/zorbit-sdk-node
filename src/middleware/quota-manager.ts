import { Request, Response, NextFunction } from 'express';

/**
 * Rate limiting configuration with multiple time windows.
 */
export interface QuotaConfig {
  /** Rate limits per time window */
  windows: {
    perSecond?: number;
    perMinute?: number;
    perHour?: number;
    perDay?: number;
    perMonth?: number;
  };
  /** Extract the rate-limiting key from a request (default: orgHashId from JWT) */
  keyExtractor?: (req: Request) => string;
  /** Custom handler when quota is exceeded */
  onExceeded?: (req: Request, res: Response, window: string) => void;
}

/**
 * Window durations in milliseconds.
 */
const WINDOW_DURATIONS: Record<string, number> = {
  perSecond: 1_000,
  perMinute: 60_000,
  perHour: 3_600_000,
  perDay: 86_400_000,
  perMonth: 2_592_000_000, // 30 days
};

/**
 * Human-readable window labels for headers.
 */
const WINDOW_LABELS: Record<string, string> = {
  perSecond: 'per-second',
  perMinute: 'per-minute',
  perHour: 'per-hour',
  perDay: 'per-day',
  perMonth: 'per-month',
};

/**
 * Internal sliding window counter for a single key+window combination.
 */
interface WindowCounter {
  /** Timestamps of requests within the current window */
  timestamps: number[];
}

/**
 * In-memory rate limiter store.
 * Structure: Map<compositeKey, WindowCounter>
 * where compositeKey = `${rateLimitKey}:${windowName}`
 */
const store = new Map<string, WindowCounter>();

/**
 * Clean up expired timestamps from a counter.
 */
function pruneCounter(counter: WindowCounter, windowMs: number, now: number): void {
  const cutoff = now - windowMs;
  // Find first index that is >= cutoff
  let i = 0;
  while (i < counter.timestamps.length && counter.timestamps[i] < cutoff) {
    i++;
  }
  if (i > 0) {
    counter.timestamps.splice(0, i);
  }
}

/**
 * Check a single window for a key. Returns the count within the window.
 */
function checkWindow(
  key: string,
  windowName: string,
  windowMs: number,
  now: number,
): { count: number; counter: WindowCounter } {
  const compositeKey = `${key}:${windowName}`;
  let counter = store.get(compositeKey);
  if (!counter) {
    counter = { timestamps: [] };
    store.set(compositeKey, counter);
  }
  pruneCounter(counter, windowMs, now);
  return { count: counter.timestamps.length, counter };
}

/**
 * Default key extractor: uses orgHashId from JWT payload on req.user.
 * Falls back to IP address if no JWT is present.
 */
function defaultKeyExtractor(req: Request): string {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const user = (req as any).user as Record<string, unknown> | undefined;
  if (user?.org) return String(user.org);
  if (user?.organizationHashId) return String(user.organizationHashId);
  return req.ip || req.socket.remoteAddress || 'unknown';
}

/**
 * Create an Express/NestJS-compatible quota management middleware.
 *
 * Uses in-memory sliding window counters for rate limiting.
 * Supports multiple simultaneous time windows (per-second, per-minute, etc.).
 *
 * Adds standard rate-limit headers to every response:
 * - X-RateLimit-Limit
 * - X-RateLimit-Remaining
 * - X-RateLimit-Reset (Unix timestamp)
 * - X-RateLimit-Window
 *
 * @example
 * ```typescript
 * import { createQuotaManager } from '@zorbit-platform/sdk-node';
 *
 * app.use(createQuotaManager({
 *   windows: {
 *     perSecond: 10,
 *     perMinute: 60,
 *     perHour: 1000,
 *   },
 * }));
 * ```
 */
export function createQuotaManager(config: QuotaConfig) {
  const keyExtractor = config.keyExtractor || defaultKeyExtractor;

  return (req: Request, res: Response, next: NextFunction): void => {
    const key = keyExtractor(req);
    const now = Date.now();

    // Check each configured window
    for (const [windowName, limit] of Object.entries(config.windows)) {
      if (limit === undefined || limit === null) continue;

      const windowMs = WINDOW_DURATIONS[windowName];
      if (!windowMs) continue;

      const { count, counter } = checkWindow(key, windowName, windowMs, now);

      if (count >= limit) {
        // Quota exceeded for this window
        const resetTime = counter.timestamps.length > 0
          ? Math.ceil((counter.timestamps[0] + windowMs) / 1000)
          : Math.ceil((now + windowMs) / 1000);

        res.setHeader('X-RateLimit-Limit', String(limit));
        res.setHeader('X-RateLimit-Remaining', '0');
        res.setHeader('X-RateLimit-Reset', String(resetTime));
        res.setHeader('X-RateLimit-Window', WINDOW_LABELS[windowName] || windowName);
        res.setHeader('Retry-After', String(Math.ceil((resetTime * 1000 - now) / 1000)));

        if (config.onExceeded) {
          config.onExceeded(req, res, WINDOW_LABELS[windowName] || windowName);
          return;
        }

        res.status(429).json({
          error: {
            code: 'QUOTA_EXCEEDED',
            message: `Rate limit exceeded for window: ${WINDOW_LABELS[windowName] || windowName}`,
            statusCode: 429,
            details: {
              window: WINDOW_LABELS[windowName] || windowName,
              limit,
              resetAt: new Date(resetTime * 1000).toISOString(),
            },
          },
        });
        return;
      }
    }

    // All windows have capacity - record the request in each window
    for (const [windowName, limit] of Object.entries(config.windows)) {
      if (limit === undefined || limit === null) continue;

      const windowMs = WINDOW_DURATIONS[windowName];
      if (!windowMs) continue;

      const compositeKey = `${key}:${windowName}`;
      let counter = store.get(compositeKey);
      if (!counter) {
        counter = { timestamps: [] };
        store.set(compositeKey, counter);
      }
      counter.timestamps.push(now);
    }

    // Set rate limit headers for the most restrictive window
    const mostRestrictive = findMostRestrictiveWindow(key, config.windows, now);
    if (mostRestrictive) {
      res.setHeader('X-RateLimit-Limit', String(mostRestrictive.limit));
      res.setHeader('X-RateLimit-Remaining', String(mostRestrictive.remaining));
      res.setHeader(
        'X-RateLimit-Reset',
        String(Math.ceil((now + mostRestrictive.windowMs) / 1000)),
      );
      res.setHeader('X-RateLimit-Window', mostRestrictive.windowLabel);
    }

    next();
  };
}

/**
 * Find the window with the least remaining capacity (most restrictive).
 */
function findMostRestrictiveWindow(
  key: string,
  windows: QuotaConfig['windows'],
  now: number,
): { limit: number; remaining: number; windowMs: number; windowLabel: string } | null {
  let result: { limit: number; remaining: number; windowMs: number; windowLabel: string } | null =
    null;
  let lowestRemainingRatio = Infinity;

  for (const [windowName, limit] of Object.entries(windows)) {
    if (limit === undefined || limit === null) continue;

    const windowMs = WINDOW_DURATIONS[windowName];
    if (!windowMs) continue;

    const { count } = checkWindow(key, windowName, windowMs, now);
    const remaining = Math.max(0, limit - count);
    const ratio = remaining / limit;

    if (ratio < lowestRemainingRatio) {
      lowestRemainingRatio = ratio;
      result = {
        limit,
        remaining,
        windowMs,
        windowLabel: WINDOW_LABELS[windowName] || windowName,
      };
    }
  }

  return result;
}

/**
 * Clear all rate limit counters. Useful for testing.
 */
export function clearQuotaStore(): void {
  store.clear();
}
