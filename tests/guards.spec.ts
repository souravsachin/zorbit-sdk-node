/**
 * Guard tests — cover the three NestJS guards the SDK exposes.
 *
 * We don't spin up a real NestJS app — just invoke canActivate() with
 * hand-built ExecutionContexts that supply the minimum shape each
 * guard inspects.
 */
import { ForbiddenException, ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { ZorbitNamespaceGuard } from '../src/nestjs/zorbit-namespace.guard';
import { ZorbitPrivilegeGuard } from '../src/nestjs/zorbit-privilege.guard';
import {
  IS_PUBLIC_KEY,
  REQUIRED_PRIVILEGES_KEY,
} from '../src/nestjs/decorators';

function makeContext(opts: {
  user?: Record<string, unknown>;
  params?: Record<string, string>;
  path?: string;
  handler?: () => void;
  classRef?: new () => unknown;
}): ExecutionContext {
  const handler = opts.handler ?? (() => {});
  const classRef = opts.classRef ?? class Dummy {};
  return {
    switchToHttp: () => ({
      getRequest: () => ({
        user: opts.user,
        params: opts.params ?? {},
        path: opts.path ?? '/',
      }),
      getResponse: () => ({}),
      getNext: () => () => {},
    }),
    getHandler: () => handler,
    getClass: () => classRef,
    getArgs: () => [],
    getArgByIndex: () => undefined,
    switchToRpc: () => ({}) as never,
    switchToWs: () => ({}) as never,
    getType: () => 'http' as never,
  } as unknown as ExecutionContext;
}

function makeReflector(
  values: Record<string | symbol, unknown>,
): Reflector {
  return {
    get: (key: string | symbol) => values[key as string],
    getAll: (key: string | symbol) => values[key as string],
    getAllAndMerge: (key: string | symbol) => values[key as string],
    getAllAndOverride: (key: string | symbol) => values[key as string],
  } as unknown as Reflector;
}

describe('ZorbitNamespaceGuard', () => {
  it('passes when @Public()', () => {
    const guard = new ZorbitNamespaceGuard(
      makeReflector({ [IS_PUBLIC_KEY]: true }),
    );
    expect(guard.canActivate(makeContext({}))).toBe(true);
  });

  it('throws when no user is present', () => {
    const guard = new ZorbitNamespaceGuard(makeReflector({}));
    expect(() => guard.canActivate(makeContext({}))).toThrow(ForbiddenException);
  });

  it('passes when route has no :orgId or :userId', () => {
    const guard = new ZorbitNamespaceGuard(makeReflector({}));
    expect(
      guard.canActivate(
        makeContext({ user: { sub: 'U-1', org: 'O-1', type: 'access' } }),
      ),
    ).toBe(true);
  });

  it('passes when :orgId matches user.org', () => {
    const guard = new ZorbitNamespaceGuard(makeReflector({}));
    expect(
      guard.canActivate(
        makeContext({
          user: { sub: 'U-1', org: 'O-1', type: 'access' },
          params: { orgId: 'O-1' },
        }),
      ),
    ).toBe(true);
  });

  it('denies cross-org access without bypass privilege', () => {
    const guard = new ZorbitNamespaceGuard(makeReflector({}));
    expect(() =>
      guard.canActivate(
        makeContext({
          user: { sub: 'U-1', org: 'O-1', type: 'access', privileges: [] },
          params: { orgId: 'O-99' },
        }),
      ),
    ).toThrow(/namespace mismatch/);
  });

  it('allows cross-org access with platform.namespace.bypass', () => {
    const guard = new ZorbitNamespaceGuard(makeReflector({}));
    expect(
      guard.canActivate(
        makeContext({
          user: {
            sub: 'U-1',
            org: 'O-1',
            type: 'access',
            privileges: ['platform.namespace.bypass'],
          },
          params: { orgId: 'O-99' },
        }),
      ),
    ).toBe(true);
  });

  it('allows self-access on :userId', () => {
    const guard = new ZorbitNamespaceGuard(makeReflector({}));
    expect(
      guard.canActivate(
        makeContext({
          user: { sub: 'U-1', org: 'O-1', type: 'access' },
          params: { userId: 'U-1' },
        }),
      ),
    ).toBe(true);
  });

  it('denies cross-user access without bypass privilege', () => {
    const guard = new ZorbitNamespaceGuard(makeReflector({}));
    expect(() =>
      guard.canActivate(
        makeContext({
          user: { sub: 'U-1', org: 'O-1', type: 'access', privileges: [] },
          params: { userId: 'U-99' },
        }),
      ),
    ).toThrow(/namespace mismatch/);
  });

  it('allows cross-user access with platform.namespace.bypass', () => {
    const guard = new ZorbitNamespaceGuard(makeReflector({}));
    expect(
      guard.canActivate(
        makeContext({
          user: {
            sub: 'U-1',
            org: 'O-1',
            type: 'access',
            privileges: ['platform.namespace.bypass'],
          },
          params: { userId: 'U-99' },
        }),
      ),
    ).toBe(true);
  });
});

describe('ZorbitPrivilegeGuard', () => {
  it('passes when @Public()', () => {
    const guard = new ZorbitPrivilegeGuard(
      makeReflector({ [IS_PUBLIC_KEY]: true }),
    );
    expect(guard.canActivate(makeContext({}))).toBe(true);
  });

  it('passes when no privileges are required on the handler', () => {
    const guard = new ZorbitPrivilegeGuard(makeReflector({}));
    expect(
      guard.canActivate(
        makeContext({
          user: { sub: 'U-1', type: 'access', privileges: [] },
        }),
      ),
    ).toBe(true);
  });

  it('denies when user lacks required privileges', () => {
    const guard = new ZorbitPrivilegeGuard(
      makeReflector({ [REQUIRED_PRIVILEGES_KEY]: ['m.r.create'] }),
    );
    expect(() =>
      guard.canActivate(
        makeContext({
          user: { sub: 'U-1', type: 'access', privileges: ['other.priv'] },
        }),
      ),
    ).toThrow(/Insufficient privileges/);
  });

  it('passes when user has all required privileges', () => {
    const guard = new ZorbitPrivilegeGuard(
      makeReflector({ [REQUIRED_PRIVILEGES_KEY]: ['m.r.create'] }),
    );
    expect(
      guard.canActivate(
        makeContext({
          user: { sub: 'U-1', type: 'access', privileges: ['m.r.create'] },
        }),
      ),
    ).toBe(true);
  });

  it('throws when user is absent and privileges are required', () => {
    const guard = new ZorbitPrivilegeGuard(
      makeReflector({ [REQUIRED_PRIVILEGES_KEY]: ['m.r.create'] }),
    );
    expect(() => guard.canActivate(makeContext({}))).toThrow(ForbiddenException);
  });

  it('requires ALL listed privileges (AND semantics)', () => {
    const guard = new ZorbitPrivilegeGuard(
      makeReflector({
        [REQUIRED_PRIVILEGES_KEY]: ['m.r.create', 'm.r.read'],
      }),
    );
    expect(() =>
      guard.canActivate(
        makeContext({
          user: { sub: 'U-1', type: 'access', privileges: ['m.r.create'] },
        }),
      ),
    ).toThrow(/m\.r\.read/);
  });

  it('bypasses all checks for users with platform.superadmin.bypass', () => {
    const guard = new ZorbitPrivilegeGuard(
      makeReflector({
        [REQUIRED_PRIVILEGES_KEY]: ['anything.very.strict', 'another.one'],
      }),
    );
    expect(
      guard.canActivate(
        makeContext({
          user: {
            sub: 'U-SA',
            type: 'access',
            privileges: ['platform.superadmin.bypass'],
          },
        }),
      ),
    ).toBe(true);
  });
});
