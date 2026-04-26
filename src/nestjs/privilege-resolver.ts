/**
 * privilege-resolver.ts — slim-JWT support (cycle-105 / E-JWT-SLIM)
 *
 * When zorbit-identity issues a slim token, the JWT no longer carries the
 * privileges array directly. Instead it carries `privilege_set_hash` — a
 * stable identifier (e.g. "v1-a3c91e2f4d7b") for the user's resolved
 * privilege set.
 *
 * SDK-side, the JWT strategy must look up the hash → privileges[] mapping
 * via the identity service's GET /api/identity/api/v1/G/privileges/by-hash/:hash
 * endpoint, and cache it. Since hashes are content-addressed (SHA-256 of
 * the sorted privileges), the mapping is *immutable per hash*; cache TTL
 * can be aggressive without staleness risk.
 *
 * Cache: in-memory LRU-ish Map with size cap + TTL. No Redis dependency to
 * keep the SDK light. Each service process has its own cache; identical
 * hashes across services hit the network once per process.
 *
 * SDK 0.5.10 — cache-hit-ratio observability + LRU tuning (soldier (y)
 * directive 2026-04-26 22:25 +07).
 *
 *   - `getStats()` now exposes `evictions`, `ttlMs`, `maxEntries` and an
 *     approximate `oldestAgeMs` so operators can verify the cache isn't
 *     thrashing.
 *   - A periodic logger emits `[PrivilegeResolver] hits=X misses=Y ratio=Z
 *     evictions=E size=N ttlMs=T` once every 5 minutes.  The interval is
 *     unref()'d so it never holds the event loop open at shutdown.
 *   - TTL is now configurable via `ZORBIT_SDK_PR_TTL_MS` (default 30 min,
 *     unchanged) — operators can shorten it after a fleet-wide privilege
 *     change without rebuilding the SDK.  Max entries is configurable via
 *     `ZORBIT_SDK_PR_MAX_ENTRIES` (default 1000).
 *
 *   Sizing rationale (2026-04-26): for a 60-service fleet × ~10 distinct
 *   privilege-set hashes per org × handful of orgs, the working set is
 *   well under 1000 per process.  We leave the default cap at 1000 (cheap
 *   memory budget — at ~100 bytes per entry that's < 100 KB per process),
 *   and the default TTL at 30 minutes because hashes are immutable per
 *   value.  A shorter TTL only matters if you want to release memory after
 *   a privilege rotation; in that case set `ZORBIT_SDK_PR_TTL_MS=900000`
 *   (15 min) at deploy.
 */

import { Logger } from '@nestjs/common';

interface CacheEntry {
  privileges: string[];
  expiresAt: number;
  insertedAt: number;
}

const DEFAULT_TTL_MS = 30 * 60 * 1000; // 30 minutes
const DEFAULT_MAX_ENTRIES = 1000;
const STATS_LOG_INTERVAL_MS = 5 * 60 * 1000; // 5 minutes

/**
 * Default HTTP timeout for the by-hash lookup. Bumped from 5s → 10s in
 * SDK 0.5.6 because identity's `/api/v1/G/privileges/by-hash/:hash` endpoint
 * was observed at p95 5.0–6.5s under load (cycle-105/E-JWT-SLIM rollout,
 * 2026-04-25). Override via env: `ZORBIT_SDK_BY_HASH_TIMEOUT_MS`.
 *
 * Identity-side perf work is tracked separately (target p95 < 500ms with
 * server-side cache); once that lands, the timeout can be tightened back.
 */
const DEFAULT_FETCH_TIMEOUT_MS = 10_000;

function resolveFetchTimeoutMs(): number {
  const raw = process.env.ZORBIT_SDK_BY_HASH_TIMEOUT_MS;
  if (!raw) return DEFAULT_FETCH_TIMEOUT_MS;
  const n = Number.parseInt(raw, 10);
  return Number.isFinite(n) && n > 0 ? n : DEFAULT_FETCH_TIMEOUT_MS;
}

function resolveTtlMs(): number {
  const raw = process.env.ZORBIT_SDK_PR_TTL_MS;
  if (!raw) return DEFAULT_TTL_MS;
  const n = Number.parseInt(raw, 10);
  return Number.isFinite(n) && n > 0 ? n : DEFAULT_TTL_MS;
}

function resolveMaxEntries(): number {
  const raw = process.env.ZORBIT_SDK_PR_MAX_ENTRIES;
  if (!raw) return DEFAULT_MAX_ENTRIES;
  const n = Number.parseInt(raw, 10);
  return Number.isFinite(n) && n > 0 ? n : DEFAULT_MAX_ENTRIES;
}

export interface PrivilegeResolverStats {
  hits: number;
  misses: number;
  fetches: number;
  fetchFailures: number;
  evictions: number;
  size: number;
  hitRatio: number;
  ttlMs: number;
  maxEntries: number;
  /** Approximate age of the oldest cache entry (insertion order); 0 if empty. */
  oldestAgeMs: number;
}

export class PrivilegeResolver {
  private static instance: PrivilegeResolver | null = null;
  private readonly logger = new Logger(PrivilegeResolver.name);
  private readonly cache = new Map<string, CacheEntry>();
  private hits = 0;
  private misses = 0;
  private fetches = 0;
  private fetchFailures = 0;
  private evictions = 0;
  private statsTimer: NodeJS.Timeout | null = null;

  private readonly fetchTimeoutMs: number;

  private constructor(
    private readonly ttlMs: number = resolveTtlMs(),
    private readonly maxEntries: number = resolveMaxEntries(),
    fetchTimeoutMs: number = resolveFetchTimeoutMs(),
  ) {
    this.fetchTimeoutMs = fetchTimeoutMs;
    this.startStatsTimer();
  }

  /** Test/diagnostic — read the resolved HTTP timeout for the by-hash fetch. */
  getFetchTimeoutMs(): number {
    return this.fetchTimeoutMs;
  }

  /** Test/diagnostic — read the resolved TTL. */
  getTtlMs(): number {
    return this.ttlMs;
  }

  /** Test/diagnostic — read the resolved max-entries cap. */
  getMaxEntries(): number {
    return this.maxEntries;
  }

  /**
   * Singleton — every service process has one resolver shared across requests.
   * (Process-level cache; no need for cross-process coordination because the
   * hash is content-addressed and immutable per value.)
   */
  static getInstance(): PrivilegeResolver {
    if (!PrivilegeResolver.instance) {
      PrivilegeResolver.instance = new PrivilegeResolver();
    }
    return PrivilegeResolver.instance;
  }

  /** Test-only: reset the singleton (e.g. between Jest specs). */
  static __resetForTests(): void {
    if (PrivilegeResolver.instance) {
      PrivilegeResolver.instance.stopStatsTimer();
    }
    PrivilegeResolver.instance = null;
  }

  /**
   * Resolve `privilege_set_hash` → privileges[].
   *
   * Lookup order:
   *   1. In-memory cache hit (returns instantly)
   *   2. HTTP GET to identity service (cached on success)
   *
   * On HTTP failure, returns an empty array AND does NOT cache the failure
   * — the next request will retry. We deliberately do NOT throw, because
   * an authenticated request should not be 5xx'd just because a privilege
   * resolution failed; the privilege guard will then deny if the array is
   * empty, which translates to a 403 (correct).
   *
   * @param hash The privilege_set_hash from the JWT (e.g. "v1-a3c91e2f4d7b")
   * @param identityUrl Base URL of the zorbit-identity service
   * @param bearerToken The same Bearer token that contained the hash — used to
   *   authenticate the lookup call (the by-hash endpoint requires a logged-in
   *   user; the hash itself is non-secret).
   */
  async resolve(
    hash: string,
    identityUrl: string,
    bearerToken: string,
  ): Promise<string[]> {
    const now = Date.now();

    // Cache hit
    const entry = this.cache.get(hash);
    if (entry && entry.expiresAt > now) {
      this.hits++;
      return entry.privileges;
    }

    // Stale or missing — fetch
    this.misses++;
    const privileges = await this.fetch(hash, identityUrl, bearerToken);
    if (privileges.length > 0) {
      this.put(hash, privileges, now);
    }
    return privileges;
  }

  private put(hash: string, privileges: string[], now: number): void {
    // Cheap LRU: when full, drop the oldest entry. Map preserves insertion order.
    if (this.cache.size >= this.maxEntries) {
      const oldestKey = this.cache.keys().next().value;
      if (oldestKey !== undefined) {
        this.cache.delete(oldestKey);
        this.evictions++;
      }
    }
    this.cache.set(hash, {
      privileges,
      expiresAt: now + this.ttlMs,
      insertedAt: now,
    });
  }

  private async fetch(
    hash: string,
    identityUrl: string,
    bearerToken: string,
  ): Promise<string[]> {
    this.fetches++;
    const url = `${identityUrl.replace(/\/$/, '')}/api/v1/G/privileges/by-hash/${encodeURIComponent(
      hash,
    )}`;
    try {
      // Dynamic import — axios is already a dependency but we keep the import
      // lazy so jest-style mocks can override it cleanly.
      const axios = (await import('axios')).default;
      const response = await axios.get<{ hash: string; privileges: string[] }>(url, {
        timeout: this.fetchTimeoutMs,
        headers: { Authorization: `Bearer ${bearerToken}` },
      });
      const list = response.data?.privileges;
      if (Array.isArray(list)) {
        return list;
      }
      this.logger.warn(
        `[PrivilegeResolver] unexpected response shape from ${url}: ${JSON.stringify(
          response.data,
        ).slice(0, 200)}`,
      );
      return [];
    } catch (err) {
      this.fetchFailures++;
      this.logger.warn(
        `[PrivilegeResolver] failed to resolve hash=${hash} via ${url}: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
      return [];
    }
  }

  /** Diagnostic — for log-once-per-N-requests style metrics. */
  getStats(): PrivilegeResolverStats {
    const total = this.hits + this.misses;
    let oldestAgeMs = 0;
    if (this.cache.size > 0) {
      const firstKey = this.cache.keys().next().value;
      if (firstKey !== undefined) {
        const entry = this.cache.get(firstKey);
        if (entry) {
          oldestAgeMs = Date.now() - entry.insertedAt;
        }
      }
    }
    return {
      hits: this.hits,
      misses: this.misses,
      fetches: this.fetches,
      fetchFailures: this.fetchFailures,
      evictions: this.evictions,
      size: this.cache.size,
      hitRatio: total === 0 ? 0 : this.hits / total,
      ttlMs: this.ttlMs,
      maxEntries: this.maxEntries,
      oldestAgeMs,
    };
  }

  /**
   * Emit a single one-line stats summary at INFO level. Operators look for
   * this in pm2 logs to confirm the cache is healthy (target hitRatio >0.95
   * after warm-up). Skipped silently if there has been zero traffic since
   * the last emission, to avoid spamming idle services.
   */
  emitStatsLog(): void {
    const total = this.hits + this.misses;
    if (total === 0) return;
    const stats = this.getStats();
    this.logger.log(
      `[PrivilegeResolver] hits=${stats.hits} misses=${stats.misses} ` +
        `ratio=${stats.hitRatio.toFixed(3)} evictions=${stats.evictions} ` +
        `size=${stats.size} ttlMs=${stats.ttlMs} ` +
        `oldestAgeMs=${stats.oldestAgeMs}`,
    );
  }

  private startStatsTimer(): void {
    if (this.statsTimer) return;
    // Skip the timer entirely under jest — Node's fake timers + open handles
    // are a recipe for hangs, and the test suite calls emitStatsLog()
    // directly when it wants to assert.
    if (process.env.NODE_ENV === 'test' || process.env.JEST_WORKER_ID) return;
    this.statsTimer = setInterval(() => {
      try {
        this.emitStatsLog();
      } catch {
        /* never let a logging error tank the resolver */
      }
    }, STATS_LOG_INTERVAL_MS);
    // Don't hold the event loop open at shutdown.
    if (typeof this.statsTimer.unref === 'function') {
      this.statsTimer.unref();
    }
  }

  private stopStatsTimer(): void {
    if (this.statsTimer) {
      clearInterval(this.statsTimer);
      this.statsTimer = null;
    }
  }
}
