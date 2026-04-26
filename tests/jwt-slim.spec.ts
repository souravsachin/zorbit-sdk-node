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
import { UnauthorizedException } from '@nestjs/common';

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
