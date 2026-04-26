/**
 * jwt-slim.spec.ts — cycle-105 / E-JWT-SLIM unit tests.
 *
 * Scope (intentional, narrow):
 *   1. PrivilegeResolver caching semantics (hit, miss + fetch, expiry, LRU,
 *      failure-no-cache, hit-ratio stats).
 *   2. ZorbitJwtStrategy.validate() routing:
 *      - legacy fat token (privileges array on payload) — passes through
 *      - slim token (privilege_set_hash) — resolves via PrivilegeResolver
 *      - slim token without Bearer header → 401
 *      - non-access token (refresh / mfa_temp) → 401
 *
 * What this file does NOT cover:
 *   - The full JWT signature path (passport-jwt does that, tested upstream).
 *   - The HTTP shape of the by-hash endpoint — that's an integration test
 *     pinned in the directive's Phase 3 verification.
 */

// Mock axios BEFORE imports that pull it in via dynamic import().
const axiosGet = jest.fn();
jest.mock('axios', () => ({ default: { get: axiosGet }, get: axiosGet }));

import { PrivilegeResolver } from '../src/nestjs/privilege-resolver';
import { ZorbitJwtStrategy, ZorbitJwtPayload } from '../src/nestjs/jwt.strategy';
import { ZorbitJwtGuard } from '../src/nestjs/zorbit-jwt.guard';
import { Reflector } from '@nestjs/core';
import {
  UnauthorizedException,
  ForbiddenException,
  HttpException,
  HttpStatus,
} from '@nestjs/common';

describe('PrivilegeResolver', () => {
  beforeEach(() => {
    PrivilegeResolver.__resetForTests();
    axiosGet.mockReset();
  });

  it('cache miss → fetches once, returns privileges, caches subsequent calls', async () => {
    axiosGet.mockResolvedValueOnce({
      data: { hash: 'v1-abc123', privileges: ['module.users.read', 'module.users.write'] },
    });

    const r = PrivilegeResolver.getInstance();
    const a = await r.resolve('v1-abc123', 'http://identity:3001', 'tok-A');
    expect(a).toEqual(['module.users.read', 'module.users.write']);
    expect(axiosGet).toHaveBeenCalledTimes(1);

    // Second call → cache hit, no second fetch
    const b = await r.resolve('v1-abc123', 'http://identity:3001', 'tok-A');
    expect(b).toEqual(['module.users.read', 'module.users.write']);
    expect(axiosGet).toHaveBeenCalledTimes(1);

    const stats = r.getStats();
    expect(stats.hits).toBe(1);
    expect(stats.misses).toBe(1);
    expect(stats.fetches).toBe(1);
    expect(stats.hitRatio).toBeCloseTo(0.5, 5);
  });

  it('on HTTP failure returns [] AND does NOT cache the failure (next call retries)', async () => {
    axiosGet.mockRejectedValueOnce(new Error('connect ECONNREFUSED'));
    axiosGet.mockResolvedValueOnce({
      data: { hash: 'v1-zzz', privileges: ['platform.superadmin.bypass'] },
    });

    const r = PrivilegeResolver.getInstance();
    const a = await r.resolve('v1-zzz', 'http://identity:3001', 'tok-X');
    expect(a).toEqual([]);

    // Next call retries — and succeeds.
    const b = await r.resolve('v1-zzz', 'http://identity:3001', 'tok-X');
    expect(b).toEqual(['platform.superadmin.bypass']);
    expect(axiosGet).toHaveBeenCalledTimes(2);

    const stats = r.getStats();
    expect(stats.fetchFailures).toBe(1);
    expect(stats.fetches).toBe(2);
  });

  it('handles unexpected response shape gracefully (returns [])', async () => {
    axiosGet.mockResolvedValueOnce({ data: { wrong: 'shape' } });
    const r = PrivilegeResolver.getInstance();
    const out = await r.resolve('v1-bad', 'http://identity:3001', 'tok');
    expect(out).toEqual([]);
  });

  it('forwards Bearer token to identity', async () => {
    axiosGet.mockResolvedValueOnce({ data: { hash: 'v1-h', privileges: [] } });
    const r = PrivilegeResolver.getInstance();
    await r.resolve('v1-h', 'http://identity:3001', 'my-secret-token');
    expect(axiosGet).toHaveBeenCalledWith(
      'http://identity:3001/api/v1/G/privileges/by-hash/v1-h',
      expect.objectContaining({
        headers: { Authorization: 'Bearer my-secret-token' },
      }),
    );
  });

  it('SDK 0.5.10 — 10 calls with same hash → 1 miss + 9 hits, ratio = 0.9', async () => {
    axiosGet.mockResolvedValueOnce({
      data: { hash: 'v1-ratio', privileges: ['mod.a.read'] },
    });

    const r = PrivilegeResolver.getInstance();
    for (let i = 0; i < 10; i++) {
      const out = await r.resolve('v1-ratio', 'http://identity:3001', 'tok');
      expect(out).toEqual(['mod.a.read']);
    }

    const stats = r.getStats();
    expect(stats.hits).toBe(9);
    expect(stats.misses).toBe(1);
    expect(stats.fetches).toBe(1);
    expect(stats.hitRatio).toBeCloseTo(0.9, 5);
    expect(stats.size).toBe(1);
    expect(stats.evictions).toBe(0);
    expect(axiosGet).toHaveBeenCalledTimes(1);
  });

  it('SDK 0.5.10 — getStats() exposes evictions, ttlMs, maxEntries, oldestAgeMs', async () => {
    const r = PrivilegeResolver.getInstance();
    const stats = r.getStats();
    // Defaults
    expect(stats.ttlMs).toBe(30 * 60 * 1000);
    expect(stats.maxEntries).toBe(1000);
    expect(stats.evictions).toBe(0);
    expect(stats.oldestAgeMs).toBe(0); // empty cache
    expect(stats.hitRatio).toBe(0); // total=0 -> 0
  });

  it('SDK 0.5.10 — TTL is configurable via ZORBIT_SDK_PR_TTL_MS', async () => {
    const before = process.env.ZORBIT_SDK_PR_TTL_MS;
    process.env.ZORBIT_SDK_PR_TTL_MS = '900000'; // 15 min
    PrivilegeResolver.__resetForTests();

    const r = PrivilegeResolver.getInstance();
    expect(r.getTtlMs()).toBe(900_000);
    expect(r.getStats().ttlMs).toBe(900_000);

    if (before === undefined) {
      delete process.env.ZORBIT_SDK_PR_TTL_MS;
    } else {
      process.env.ZORBIT_SDK_PR_TTL_MS = before;
    }
  });

  it('SDK 0.5.10 — invalid TTL env falls back to default (30 min)', async () => {
    const before = process.env.ZORBIT_SDK_PR_TTL_MS;
    process.env.ZORBIT_SDK_PR_TTL_MS = 'not-a-number';
    PrivilegeResolver.__resetForTests();

    const r = PrivilegeResolver.getInstance();
    expect(r.getTtlMs()).toBe(30 * 60 * 1000);

    if (before === undefined) {
      delete process.env.ZORBIT_SDK_PR_TTL_MS;
    } else {
      process.env.ZORBIT_SDK_PR_TTL_MS = before;
    }
  });

  it('SDK 0.5.10 — max entries is configurable via ZORBIT_SDK_PR_MAX_ENTRIES, evictions counted', async () => {
    const before = process.env.ZORBIT_SDK_PR_MAX_ENTRIES;
    process.env.ZORBIT_SDK_PR_MAX_ENTRIES = '2';
    PrivilegeResolver.__resetForTests();

    axiosGet.mockResolvedValueOnce({ data: { hash: 'h1', privileges: ['p1'] } });
    axiosGet.mockResolvedValueOnce({ data: { hash: 'h2', privileges: ['p2'] } });
    axiosGet.mockResolvedValueOnce({ data: { hash: 'h3', privileges: ['p3'] } });

    const r = PrivilegeResolver.getInstance();
    expect(r.getMaxEntries()).toBe(2);

    await r.resolve('h1', 'http://identity:3001', 'tok');
    await r.resolve('h2', 'http://identity:3001', 'tok');
    expect(r.getStats().size).toBe(2);
    expect(r.getStats().evictions).toBe(0);

    // Insert 3rd -> oldest (h1) gets evicted
    await r.resolve('h3', 'http://identity:3001', 'tok');
    expect(r.getStats().size).toBe(2);
    expect(r.getStats().evictions).toBe(1);

    if (before === undefined) {
      delete process.env.ZORBIT_SDK_PR_MAX_ENTRIES;
    } else {
      process.env.ZORBIT_SDK_PR_MAX_ENTRIES = before;
    }
  });

  it('SDK 0.5.10 — emitStatsLog() is silent when there has been zero traffic', async () => {
    const r = PrivilegeResolver.getInstance();
    const logSpy = jest.spyOn((r as any).logger, 'log').mockImplementation(() => {});
    r.emitStatsLog();
    expect(logSpy).not.toHaveBeenCalled();
    logSpy.mockRestore();
  });

  it('SDK 0.5.10 — emitStatsLog() emits one INFO line after traffic', async () => {
    axiosGet.mockResolvedValueOnce({ data: { hash: 'v1-log', privileges: ['p'] } });
    const r = PrivilegeResolver.getInstance();
    await r.resolve('v1-log', 'http://identity:3001', 'tok');
    await r.resolve('v1-log', 'http://identity:3001', 'tok');

    const logSpy = jest.spyOn((r as any).logger, 'log').mockImplementation(() => {});
    r.emitStatsLog();
    expect(logSpy).toHaveBeenCalledTimes(1);
    const msg = logSpy.mock.calls[0][0] as string;
    expect(msg).toMatch(/\[PrivilegeResolver\] hits=1 misses=1 ratio=0\.500/);
    expect(msg).toMatch(/evictions=0/);
    expect(msg).toMatch(/size=1/);
    expect(msg).toMatch(/ttlMs=/);
    logSpy.mockRestore();
  });

  it('SDK 0.5.6 — fetch timeout defaults to 10000ms (was 5000ms in 0.5.5) and is honoured by axios.get', async () => {
    // Default (no env override) — must be 10s.
    const before = process.env.ZORBIT_SDK_BY_HASH_TIMEOUT_MS;
    delete process.env.ZORBIT_SDK_BY_HASH_TIMEOUT_MS;
    PrivilegeResolver.__resetForTests();

    axiosGet.mockResolvedValueOnce({ data: { hash: 'v1-t', privileges: [] } });
    const r = PrivilegeResolver.getInstance();
    expect(r.getFetchTimeoutMs()).toBe(10_000);

    await r.resolve('v1-t', 'http://identity:3001', 'tok');
    expect(axiosGet).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({ timeout: 10_000 }),
    );

    // Override via env — singleton must be reset so the new value is read.
    process.env.ZORBIT_SDK_BY_HASH_TIMEOUT_MS = '15000';
    PrivilegeResolver.__resetForTests();
    const r2 = PrivilegeResolver.getInstance();
    expect(r2.getFetchTimeoutMs()).toBe(15_000);

    // Restore env to pre-test state.
    if (before === undefined) {
      delete process.env.ZORBIT_SDK_BY_HASH_TIMEOUT_MS;
    } else {
      process.env.ZORBIT_SDK_BY_HASH_TIMEOUT_MS = before;
    }
  });
});

describe('ZorbitJwtStrategy.validate()', () => {
  // Helper: instantiate the strategy with options. We bypass NestJS DI here.
  function makeStrategy(): ZorbitJwtStrategy {
    return new ZorbitJwtStrategy(
      { jwtSecret: 'test-secret', identityUrl: 'http://identity:3001' },
    );
  }

  beforeEach(() => {
    PrivilegeResolver.__resetForTests();
    axiosGet.mockReset();
  });

  it('legacy fat token (privileges array) — passes through unchanged, no fetch', async () => {
    const s = makeStrategy();
    const payload: ZorbitJwtPayload = {
      sub: 'U-AAA',
      org: 'O-BBB',
      type: 'access',
      privileges: ['mod.x.read', 'mod.y.write'],
    };
    const out = await s.validate({ headers: { authorization: 'Bearer foo' } }, payload);
    expect(out).toEqual(payload);
    expect(axiosGet).not.toHaveBeenCalled();
  });

  it('slim token (privilege_set_hash) — resolves and attaches privileges', async () => {
    axiosGet.mockResolvedValueOnce({
      data: { hash: 'v1-feedf00d', privileges: ['mod.a.read', 'mod.b.write'] },
    });

    const s = makeStrategy();
    const payload: ZorbitJwtPayload = {
      sub: 'U-AAA',
      org: 'O-BBB',
      type: 'access',
      privilege_set_hash: 'v1-feedf00d',
    };
    const out = await s.validate(
      { headers: { authorization: 'Bearer raw-jwt-string' } },
      payload,
    );
    expect(out.privileges).toEqual(['mod.a.read', 'mod.b.write']);
    expect(out.privilege_set_hash).toBe('v1-feedf00d');
    expect(axiosGet).toHaveBeenCalledTimes(1);
  });

  it('slim token without Authorization header → 401', async () => {
    const s = makeStrategy();
    const payload: ZorbitJwtPayload = {
      sub: 'U-X',
      org: 'O-Y',
      type: 'access',
      privilege_set_hash: 'v1-deadbeef',
    };
    await expect(s.validate({ headers: {} }, payload)).rejects.toThrow(
      UnauthorizedException,
    );
  });

  it('refresh token rejected with 401', async () => {
    const s = makeStrategy();
    const payload: ZorbitJwtPayload = { sub: 'U-X', org: 'O-Y', type: 'refresh' };
    await expect(
      s.validate({ headers: { authorization: 'Bearer x' } }, payload),
    ).rejects.toThrow(UnauthorizedException);
  });

  it('mfa_temp token rejected with 401', async () => {
    const s = makeStrategy();
    const payload: ZorbitJwtPayload = { sub: 'U-X', org: 'O-Y', type: 'mfa_temp' };
    await expect(
      s.validate({ headers: { authorization: 'Bearer x' } }, payload),
    ).rejects.toThrow(UnauthorizedException);
  });

  it('token with neither privileges nor hash — returns payload as-is (auth-only endpoints OK)', async () => {
    const s = makeStrategy();
    const payload: ZorbitJwtPayload = { sub: 'U-X', org: 'O-Y', type: 'access' };
    const out = await s.validate({ headers: { authorization: 'Bearer x' } }, payload);
    expect(out).toEqual(payload);
    expect(axiosGet).not.toHaveBeenCalled();
  });

  /**
   * SDK 0.5.7 — by-hash self-call detection.
   *
   * When the SDK strategy fires INSIDE identity's own
   * `GET /api/v1/G/privileges/by-hash/:hash` handler (because that endpoint
   * is decorated with @UseGuards(ZorbitJwtGuard)), it must NOT call
   * PrivilegeResolver.resolve() — that would HTTP-call the same endpoint,
   * triggering N-deep recursion that times out under cold cache.
   *
   * The fix detects the request URL and short-circuits with empty privileges.
   *
   * Bug history: soldier (r) finding 2026-04-25 20:23 +07; soldier (s)
   * cache-flush at 21:16 +07 surfaced the bug fleet-wide; this fix landed
   * 2026-04-26 by soldier (v).
   */
  describe('SDK 0.5.7 — by-hash self-call detection (no-recursion guarantee)', () => {
    const slimPayload: ZorbitJwtPayload = {
      sub: 'U-AAA',
      org: 'O-BBB',
      type: 'access',
      privilege_set_hash: 'v1-feedf00d',
    };

    it('skips PrivilegeResolver when request URL is /api/v1/G/privileges/by-hash/:hash', async () => {
      const s = makeStrategy();
      const req = {
        url: '/api/v1/G/privileges/by-hash/v1-feedf00d',
        headers: { authorization: 'Bearer raw-jwt-string' },
      };
      const out = await s.validate(req, slimPayload);
      // Must NOT have called resolver
      expect(axiosGet).not.toHaveBeenCalled();
      expect(out.privileges).toEqual([]);
      expect(out.privilege_set_hash).toBe('v1-feedf00d');
      // Original payload claims preserved
      expect(out.sub).toBe('U-AAA');
      expect(out.org).toBe('O-BBB');
    });

    it('skips PrivilegeResolver when originalUrl is the by-hash path (Express-style proxy)', async () => {
      const s = makeStrategy();
      const req = {
        originalUrl: '/api/identity/api/v1/G/privileges/by-hash/v1-abc123',
        url: '/api/v1/G/privileges/by-hash/v1-abc123',
        headers: { authorization: 'Bearer raw-jwt-string' },
      };
      const out = await s.validate(req, slimPayload);
      expect(axiosGet).not.toHaveBeenCalled();
      expect(out.privileges).toEqual([]);
    });

    it('skips PrivilegeResolver when by-hash URL has trailing slash', async () => {
      const s = makeStrategy();
      const req = {
        url: '/api/v1/G/privileges/by-hash/v1-feedf00d/',
        headers: { authorization: 'Bearer x' },
      };
      const out = await s.validate(req, slimPayload);
      expect(axiosGet).not.toHaveBeenCalled();
      expect(out.privileges).toEqual([]);
    });

    it('skips PrivilegeResolver when by-hash URL has query string', async () => {
      const s = makeStrategy();
      const req = {
        url: '/api/v1/G/privileges/by-hash/v1-feedf00d?cache=skip',
        headers: { authorization: 'Bearer x' },
      };
      const out = await s.validate(req, slimPayload);
      expect(axiosGet).not.toHaveBeenCalled();
      expect(out.privileges).toEqual([]);
    });

    it('STILL calls PrivilegeResolver for non-by-hash URLs (normal slim-token flow)', async () => {
      axiosGet.mockResolvedValueOnce({
        data: { hash: 'v1-feedf00d', privileges: ['mod.a.read', 'mod.b.write'] },
      });
      const s = makeStrategy();
      const req = {
        url: '/api/v1/O/O-DFLT/roles',
        headers: { authorization: 'Bearer raw-jwt-string' },
      };
      const out = await s.validate(req, slimPayload);
      expect(axiosGet).toHaveBeenCalledTimes(1);
      expect(out.privileges).toEqual(['mod.a.read', 'mod.b.write']);
    });

    it('does NOT match unrelated URLs that contain the substring "by-hash" (regression guard)', async () => {
      // E.g. a fictional endpoint /api/v1/G/users/by-hash-id/:id should NOT
      // be treated as the privilege-by-hash endpoint.
      axiosGet.mockResolvedValueOnce({
        data: { hash: 'v1-feedf00d', privileges: ['mod.x.read'] },
      });
      const s = makeStrategy();
      const req = {
        url: '/api/v1/G/users/by-hash-id/some-other-id',
        headers: { authorization: 'Bearer raw-jwt-string' },
      };
      const out = await s.validate(req, slimPayload);
      // Resolver was called → the URL did NOT match the by-hash regex
      expect(axiosGet).toHaveBeenCalledTimes(1);
      expect(out.privileges).toEqual(['mod.x.read']);
    });

    it('legacy fat token still passes through even when URL is by-hash', async () => {
      // A fat token should still bypass the resolver path entirely; the
      // self-call detection is irrelevant there.
      const s = makeStrategy();
      const fatPayload: ZorbitJwtPayload = {
        sub: 'U-AAA',
        org: 'O-BBB',
        type: 'access',
        privileges: ['platform.superadmin.bypass'],
      };
      const req = {
        url: '/api/v1/G/privileges/by-hash/v1-anything',
        headers: { authorization: 'Bearer raw-jwt-string' },
      };
      const out = await s.validate(req, fatPayload);
      expect(axiosGet).not.toHaveBeenCalled();
      expect(out.privileges).toEqual(['platform.superadmin.bypass']);
    });
  });
});

/**
 * ZorbitJwtGuard.handleRequest 401-vs-500 mapping.
 *
 * Cycle-105 / E-JWT-SLIM (SDK 0.5.5) — soldier (i) reported that stale tokens
 * surfaced as 500 instead of 401 on `/api/authorization/.../roles`. Root
 * cause: pre-fix code threw the raw passport `err` (a non-HttpException
 * Error) directly, which Nest's BaseExceptionFilter mapped to 500.
 * Verifies all four call paths now map to 401.
 */
describe('ZorbitJwtGuard.handleRequest — 401 mapping', () => {
  function makeGuard(): ZorbitJwtGuard {
    return new ZorbitJwtGuard(new Reflector());
  }

  it('passes user through when authenticated (no err, user present)', () => {
    const g = makeGuard();
    const user = { sub: 'U-1', org: 'O-1', type: 'access' as const };
    const out = g.handleRequest(null, user, undefined);
    expect(out).toEqual(user);
  });

  it('non-HttpException Error from passport → 401 (was 500)', () => {
    const g = makeGuard();
    const err = new Error('jwt malformed');
    expect(() => g.handleRequest(err, false, undefined)).toThrow(
      UnauthorizedException,
    );
    try {
      g.handleRequest(err, false, undefined);
    } catch (e) {
      expect(e).toBeInstanceOf(HttpException);
      expect((e as HttpException).getStatus()).toBe(HttpStatus.UNAUTHORIZED);
      expect((e as Error).message).toBe('jwt malformed');
    }
  });

  it('TokenExpiredError-style info → 401', () => {
    const g = makeGuard();
    // passport-jwt presents expired tokens via `info: TokenExpiredError`,
    // err is null. Pre-fix this still went to the right side of `||` and
    // worked; we keep that path covered.
    const info = new Error('jwt expired');
    expect(() => g.handleRequest(null, false, info)).toThrow(
      UnauthorizedException,
    );
    try {
      g.handleRequest(null, false, info);
    } catch (e) {
      expect((e as HttpException).getStatus()).toBe(HttpStatus.UNAUTHORIZED);
      expect((e as Error).message).toBe('jwt expired');
    }
  });

  it('No-auth-token (no err, no user, info is string-like) → 401', () => {
    const g = makeGuard();
    const out = (() => {
      try {
        g.handleRequest(null, false, 'No auth token');
        return null;
      } catch (e) {
        return e;
      }
    })();
    expect(out).toBeInstanceOf(HttpException);
    expect((out as HttpException).getStatus()).toBe(HttpStatus.UNAUTHORIZED);
    expect((out as Error).message).toBe('No auth token');
  });

  it('Custom HttpException from upstream is re-thrown verbatim (not double-wrapped)', () => {
    const g = makeGuard();
    const custom = new ForbiddenException('Account locked'); // 403, not 401
    try {
      g.handleRequest(custom, false, undefined);
    } catch (e) {
      // Exact same instance — no wrapping. Status preserved as 403.
      expect(e).toBe(custom);
      expect((e as HttpException).getStatus()).toBe(HttpStatus.FORBIDDEN);
    }
  });
});
