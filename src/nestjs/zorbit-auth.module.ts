/**
 * ZorbitAuthModule — dynamic NestJS module that wires up Passport JWT
 * authentication for any Zorbit service in a single line.
 *
 * Background
 * ----------
 * Pre-0.5.0 every consumer service had to hand-wire:
 *   - PassportModule.register({ defaultStrategy: 'jwt' })
 *   - JwtModule.registerAsync({ ... })
 *   - a local copy of JwtStrategy
 *   - a providers entry for that strategy
 *
 * That boilerplate, scattered across 24+ services, was the root cause of
 * cycle-103's restart-loop class — services that didn't wire ConfigModule
 * globally crashed with `Cannot read properties of undefined (reading 'get')`
 * inside the strategy constructor.
 *
 * 0.5.0 introduces this module: one import, one option (jwtSecret), all
 * the wiring lives inside the SDK.
 *
 * Usage
 * -----
 * ```ts
 * import { ZorbitAuthModule } from '@zorbit-platform/sdk-node';
 *
 * @Module({
 *   imports: [
 *     ZorbitAuthModule.forRoot({
 *       jwtSecret: process.env.JWT_SECRET ?? 'dev-secret-change-in-production',
 *     }),
 *     // ... other modules
 *   ],
 * })
 * export class AppModule {}
 * ```
 *
 * Feature modules then no longer need PassportModule/JwtModule/JwtStrategy
 * imports. Guards (`ZorbitJwtGuard`, `ZorbitPrivilegeGuard`,
 * `ZorbitNamespaceGuard`) are exported globally and can be used via
 * `@UseGuards(...)` from any controller.
 *
 * See also
 * --------
 * - 00_docs/platform/sdk-di-factory-design.md — full design rationale
 *   including options A/B/C considered and the per-consumer migration
 *   cookbook.
 */
import { DynamicModule, Module } from '@nestjs/common';
import { PassportModule } from '@nestjs/passport';
import { ZORBIT_AUTH_OPTIONS, ZorbitAuthOptions } from './zorbit-auth-options';
import { ZorbitJwtStrategy } from './jwt.strategy';
import { ZorbitJwtGuard } from './zorbit-jwt.guard';
import { ZorbitNamespaceGuard } from './zorbit-namespace.guard';
import { ZorbitPrivilegeGuard } from './zorbit-privilege.guard';

@Module({})
export class ZorbitAuthModule {
  /**
   * Static factory — call once in your service's root AppModule.
   *
   * @param options.jwtSecret  the symmetric secret that zorbit-identity uses
   *                           to sign access tokens. Pass via env var; never
   *                           hardcode.
   * @returns a global DynamicModule that registers PassportModule,
   *          ZorbitJwtStrategy, and the three Zorbit guards.
   */
  static forRoot(options: ZorbitAuthOptions): DynamicModule {
    if (!options || typeof options.jwtSecret !== 'string' || options.jwtSecret.length === 0) {
      // Fail loud at boot. Better than silently signing with `undefined`.
      throw new Error(
        '[ZorbitAuthModule.forRoot] jwtSecret is required and must be a non-empty string. ' +
          'Pass process.env.JWT_SECRET (or your own resolution).',
      );
    }

    return {
      module: ZorbitAuthModule,
      global: true,
      imports: [PassportModule.register({ defaultStrategy: 'jwt' })],
      providers: [
        { provide: ZORBIT_AUTH_OPTIONS, useValue: options },
        ZorbitJwtStrategy,
        ZorbitJwtGuard,
        ZorbitNamespaceGuard,
        ZorbitPrivilegeGuard,
      ],
      exports: [
        ZorbitJwtStrategy,
        ZorbitJwtGuard,
        ZorbitNamespaceGuard,
        ZorbitPrivilegeGuard,
        PassportModule,
      ],
    };
  }
}
