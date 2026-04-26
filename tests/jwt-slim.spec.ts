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
