/**
 * ZorbitAuthModule.forRoot() smoke tests.
 *
 * Verifies the DynamicModule shape WITHOUT booting a NestJS app. We only
 * assert the static description (imports/providers/exports/global flag)
 * and a strategy-secret-resolution unit test — anything more requires
 * a real Nest container which the SDK test rig doesn't provide.
 *
 * Owner test plan: full integration (boot pii-vault with the new
 * AppModule, hit /tokenize with a JWT) lives in
 * 00_docs/platform/sdk-di-factory-design.md §7.
 */

import { ZorbitAuthModule } from '../src/nestjs/zorbit-auth.module';
import { ZORBIT_AUTH_OPTIONS } from '../src/nestjs/zorbit-auth-options';
import { ZorbitJwtStrategy } from '../src/nestjs/jwt.strategy';
import { ZorbitJwtGuard } from '../src/nestjs/zorbit-jwt.guard';
import { ZorbitNamespaceGuard } from '../src/nestjs/zorbit-namespace.guard';
import { ZorbitPrivilegeGuard } from '../src/nestjs/zorbit-privilege.guard';
import { Reflector } from '@nestjs/core';
import { PassportModule } from '@nestjs/passport';

describe('ZorbitAuthModule.forRoot()', () => {
  it('returns a global DynamicModule with PassportModule + 4 providers + 4 exports', () => {
    const dm = ZorbitAuthModule.forRoot({ jwtSecret: 'test-secret-1234' });

    expect(dm.module).toBe(ZorbitAuthModule);
    expect(dm.global).toBe(true);

    // PassportModule.register() returns a DynamicModule whose .module === PassportModule
    const passportImport = (dm.imports ?? [])[0] as { module?: unknown };
    expect(passportImport).toBeDefined();
    expect(passportImport.module).toBe(PassportModule);

    // Providers: options-value + Reflector (cycle-104 fix) + strategy + 3 guards
    const providers = dm.providers ?? [];
    expect(providers).toContain(Reflector);
    expect(providers).toContain(ZorbitJwtStrategy);
    expect(providers).toContain(ZorbitJwtGuard);
    expect(providers).toContain(ZorbitNamespaceGuard);
    expect(providers).toContain(ZorbitPrivilegeGuard);

    const valueProvider = providers.find(
      (p): p is { provide: symbol; useValue: { jwtSecret: string } } =>
        typeof p === 'object' &&
        p !== null &&
        'provide' in p &&
        (p as { provide: unknown }).provide === ZORBIT_AUTH_OPTIONS,
    );
    expect(valueProvider).toBeDefined();
    expect(valueProvider!.useValue.jwtSecret).toBe('test-secret-1234');

    // Exports: same shape as providers minus the options object,
    // plus PassportModule for downstream re-import convenience.
    // Cycle-104: Reflector exported so consumer @UseGuards() can resolve.
    const exports = dm.exports ?? [];
    expect(exports).toContain(Reflector);
    expect(exports).toContain(ZorbitJwtStrategy);
    expect(exports).toContain(ZorbitJwtGuard);
    expect(exports).toContain(ZorbitNamespaceGuard);
    expect(exports).toContain(ZorbitPrivilegeGuard);
    expect(exports).toContain(PassportModule);
  });

  it('throws at boot if jwtSecret is missing', () => {
    expect(() =>
      ZorbitAuthModule.forRoot({ jwtSecret: '' }),
    ).toThrow(/jwtSecret is required/);

    // Casting around the type — runtime guard test.
    expect(() =>
      ZorbitAuthModule.forRoot({} as unknown as { jwtSecret: string }),
    ).toThrow(/jwtSecret is required/);
  });
});

describe('ZorbitJwtStrategy.resolveSecret (private static)', () => {
  // Access the private static via prototype index — TypeScript private is
  // structural, not runtime. Used by tests only.
  const resolveSecret = (
    ZorbitJwtStrategy as unknown as {
      resolveSecret: (
        opts?: { jwtSecret: string },
        cfg?: { get<T = unknown>(k: string): T | undefined },
      ) => string;
    }
  ).resolveSecret;

  it('prefers options.jwtSecret over ConfigService', () => {
    const out = resolveSecret(
      { jwtSecret: 'from-options' },
      { get: () => 'from-config' as unknown as undefined },
    );
    expect(out).toBe('from-options');
  });

  it('falls back to ConfigService when options absent', () => {
    const out = resolveSecret(undefined, {
      get: <T = unknown>(k: string): T | undefined =>
        (k === 'JWT_SECRET' ? ('from-config' as unknown as T) : undefined),
    });
    expect(out).toBe('from-config');
  });

  it('falls back to dev default when ConfigService returns undefined', () => {
    const out = resolveSecret(undefined, { get: () => undefined });
    expect(out).toBe('dev-secret-change-in-production');
  });

  it('throws when neither options nor ConfigService is available', () => {
    expect(() => resolveSecret(undefined, undefined)).toThrow(
      /cannot resolve JWT secret/,
    );
  });
});
