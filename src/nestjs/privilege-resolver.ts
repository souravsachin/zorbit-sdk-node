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
 */

import { Logger } from '@nestjs/common';

interface CacheEntry {
  privileges: string[];
  expiresAt: number;
}

const DEFAULT_TTL_MS = 30 * 60 * 1000; // 30 minutes
const DEFAULT_MAX_ENTRIES = 1000;

export class PrivilegeResolver {
  private static instance: PrivilegeResolver | null = null;
  private readonly logger = new Logger(PrivilegeResolver.name);
  private readonly cache = new Map<string, CacheEntry>();
  private hits = 0;
  private misses = 0;
  private fetches = 0;
  private fetchFailures = 0;

  private constructor(
    private readonly ttlMs: number = DEFAULT_TTL_MS,
    private readonly maxEntries: number = DEFAULT_MAX_ENTRIES,
  ) {}

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
      }
    }
    this.cache.set(hash, { privileges, expiresAt: now + this.ttlMs });
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
        timeout: 5000,
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
  getStats(): {
    hits: number;
    misses: number;
    fetches: number;
    fetchFailures: number;
    size: number;
    hitRatio: number;
  } {
    const total = this.hits + this.misses;
    return {
      hits: this.hits,
      misses: this.misses,
      fetches: this.fetches,
      fetchFailures: this.fetchFailures,
      size: this.cache.size,
      hitRatio: total === 0 ? 0 : this.hits / total,
    };
  }
}
