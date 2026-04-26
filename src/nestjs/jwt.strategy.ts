import { Inject, Injectable, Optional, UnauthorizedException } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { ConfigService } from '@nestjs/config';
import { ZORBIT_AUTH_OPTIONS, ZorbitAuthOptions } from './zorbit-auth-options';

/**
 * JWT payload structure issued by zorbit-identity.
 * All Zorbit services validate tokens using this shape.
 */
export interface ZorbitJwtPayload {
  /** User short hash ID, e.g. "U-81F3" */
  sub: string;
  /** Organization short hash ID, e.g. "O-92AF" */
  org: string;
  /** User display name */
  displayName?: string;
  /** Legacy name alias — some services issue tokens with `name` instead of displayName */
  name?: string;
  /** Email token (PII-tokenized) */
  email?: string;
  /** V2 privilege codes resolved at login time */
  privileges?: string[];
  /** Legacy role field — prefer privileges; retained for back-compat */
  role?: string;
  /** Token type — only 'access' tokens are valid for API requests.
   *  Optional for back-compat with tokens minted before SDK enforcement. */
  type?: 'access' | 'refresh' | 'mfa_temp';
  /** Issued-at (unix seconds) — filled by jsonwebtoken */
  iat?: number;
  /** Expiry (unix seconds) — filled by jsonwebtoken */
  exp?: number;
}

/**
 * Reusable Passport JWT strategy for all Zorbit NestJS services.
 * Validates Bearer tokens issued by zorbit-identity.
 *
 * Two registration paths supported:
 *
 *   1. (RECOMMENDED, since 0.5.0) `ZorbitAuthModule.forRoot({ jwtSecret })`
 *      — module wires this strategy automatically; no consumer boilerplate.
 *
 *   2. (BACK-COMPAT) Listed in a feature module's `providers:` with
 *      ConfigModule + JwtModule + PassportModule wired locally. The
 *      strategy resolves the secret from ConfigService at boot.
 *
 * The constructor accepts BOTH options (`@Inject(ZORBIT_AUTH_OPTIONS)`) and
 * ConfigService (legacy) so existing consumers keep working unchanged.
 *
 * If neither is available, the strategy throws at boot — which is loud
 * and intentional. Silently signing with `undefined` would let invalid
 * tokens slip through.
 */
@Injectable()
export class ZorbitJwtStrategy extends PassportStrategy(Strategy, 'jwt') {
  constructor(
    @Optional() @Inject(ZORBIT_AUTH_OPTIONS) options?: ZorbitAuthOptions,
    @Optional() configService?: ConfigService,
  ) {
    // BACK-COMPAT GUARD (0.5.3): existing services subclass ZorbitJwtStrategy
    // and call `super(configService)` — passing ConfigService as the FIRST
    // positional arg. That used to land in `options` and silently fall
    // through to the throw branch. Detect this case at runtime and treat
    // the misplaced ConfigService as the configService param.
    if (
      options &&
      typeof (options as any).get === 'function' &&
      typeof (options as any).jwtSecret === 'undefined'
    ) {
      configService = options as unknown as ConfigService;
      options = undefined;
    }
    const secret = ZorbitJwtStrategy.resolveSecret(options, configService);
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: secret,
    });
  }

  /**
   * Resolution order:
   *   1. `options.jwtSecret` (when ZorbitAuthModule.forRoot supplied it)
   *   2. `configService.get('JWT_SECRET')` (back-compat path)
   *   3. throw — neither available
   */
  private static resolveSecret(
    options?: ZorbitAuthOptions,
    configService?: ConfigService,
  ): string {
    if (options && typeof options.jwtSecret === 'string' && options.jwtSecret.length > 0) {
      return options.jwtSecret;
    }
    if (configService) {
      const fromConfig = configService.get<string>('JWT_SECRET');
      if (typeof fromConfig === 'string' && fromConfig.length > 0) {
        return fromConfig;
      }
      // Configured but unset — keep the legacy default to match pre-0.5.0
      // behaviour. Owner-flagged as intentional in CLAUDE.md.
      return 'dev-secret-change-in-production';
    }
    // FINAL FALLBACK (0.5.3): NestJS DI didn't inject ConfigService here
    // (e.g. subclass declared a single arg but Nest couldn't resolve it,
    // or ConfigModule.forRoot wasn't called). Fall back to process.env so
    // a service that has JWT_SECRET in its container env still boots.
    // Without this, every consumer would require ZorbitAuthModule.forRoot
    // edits in source — too invasive for the running fleet.
    const envSecret = process.env.JWT_SECRET;
    if (typeof envSecret === 'string' && envSecret.length > 0) {
      return envSecret;
    }
    throw new Error(
      '[ZorbitJwtStrategy] cannot resolve JWT secret. Either import ' +
        'ZorbitAuthModule.forRoot({ jwtSecret }) at AppModule level OR ' +
        'register ConfigModule.forRoot({ isGlobal: true }) with a JWT_SECRET ' +
        'env var, or set process.env.JWT_SECRET.',
    );
  }

  /**
   * Called after JWT signature verification succeeds.
   * Rejects non-access tokens. Returns the payload as req.user.
   */
  validate(payload: ZorbitJwtPayload): ZorbitJwtPayload {
    // Older tokens may omit 'type'; accept them for back-compat.
    if (payload.type && payload.type !== 'access') {
      throw new UnauthorizedException('Only access tokens are accepted');
    }
    return payload;
  }
}
