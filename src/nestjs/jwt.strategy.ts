import { Inject, Injectable, Optional, UnauthorizedException, Logger } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { ConfigService } from '@nestjs/config';
import { ZORBIT_AUTH_OPTIONS, ZorbitAuthOptions } from './zorbit-auth-options';
import { PrivilegeResolver } from './privilege-resolver';

/**
 * JWT payload structure issued by zorbit-identity.
 * All Zorbit services validate tokens using this shape.
 *
 * Cycle-105 / E-JWT-SLIM (SDK 0.5.4):
 *   `privileges` is now OPTIONAL. New tokens issued by zorbit-identity carry
 *   `privilege_set_hash` instead of the full privilege array, slimming the
 *   token from ~9 KB to ~600 B for super-admins. The SDK resolves the hash
 *   to the privilege array at validate() time via the identity service's
 *   GET /api/v1/G/privileges/by-hash/:hash endpoint, with an in-process
 *   cache. Old fat tokens still work transparently — the strategy keeps
 *   `payload.privileges` if present.
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
  /**
   * Resolved privilege codes.
   *
   * - Legacy ("fat") tokens — issuer embedded the array directly.
   * - Slim tokens (cycle-105+) — issuer omits this field; SDK populates it
   *   from `privilege_set_hash` lookup at validate() time.
   *
   * Downstream guards (ZorbitPrivilegeGuard) read this field unconditionally;
   * they don't care which path produced it.
   */
  privileges?: string[];
  /**
   * Slim-token marker (cycle-105+). When present, identifies the privilege set
   * for SDK-side resolution. Format: `v1-<12hex>` (SHA-256 of sorted
   * privilege strings, version-prefixed for future hash-scheme migration).
   */
  privilege_set_hash?: string;
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
 *
 * Cycle-105 / E-JWT-SLIM:
 *  - validate() now resolves privilege_set_hash → privileges[] via
 *    PrivilegeResolver when the token doesn't carry the array directly.
 *  - passReqToCallback is enabled so we can capture the raw Bearer token to
 *    forward when calling the identity service's by-hash endpoint.
 */
@Injectable()
export class ZorbitJwtStrategy extends PassportStrategy(Strategy, 'jwt') {
  private readonly logger = new Logger(ZorbitJwtStrategy.name);
  private readonly identityUrl: string;
  private readonly resolver: PrivilegeResolver;

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
      // Cycle-105: pass req to validate() so we can read the raw Authorization
      // header for service-to-service privilege-by-hash lookup.
      passReqToCallback: true,
    });

    this.identityUrl = ZorbitJwtStrategy.resolveIdentityUrl(options, configService);
    this.resolver = PrivilegeResolver.getInstance();
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
   * Cycle-105: where to look up privilege_set_hash → privileges. Resolution:
   *   1. options.identityUrl (forRoot factory path)
   *   2. configService.get('IDENTITY_SERVICE_URL') / get('IDENTITY_URL')
   *   3. process.env.IDENTITY_SERVICE_URL / IDENTITY_URL
   *   4. http://localhost:3001 (dev fallback, matches identity dev port)
   */
  private static resolveIdentityUrl(
    options?: ZorbitAuthOptions,
    configService?: ConfigService,
  ): string {
    const fromOptions = (options as any)?.identityUrl;
    if (typeof fromOptions === 'string' && fromOptions.length > 0) {
      return fromOptions;
    }
    if (configService) {
      const v =
        configService.get<string>('IDENTITY_SERVICE_URL') ||
        configService.get<string>('IDENTITY_URL');
      if (typeof v === 'string' && v.length > 0) {
        return v;
      }
    }
    const envV = process.env.IDENTITY_SERVICE_URL || process.env.IDENTITY_URL;
    if (typeof envV === 'string' && envV.length > 0) {
      return envV;
    }
    return 'http://localhost:3001';
  }

  /**
   * Called after JWT signature verification succeeds.
   *
   * Responsibilities (cycle-105):
   *  - Reject non-access tokens (refresh, mfa_temp).
   *  - If payload carries `privileges` (legacy fat token) — return as-is.
   *  - If payload carries only `privilege_set_hash` (slim token, cycle-105+)
   *    — resolve via PrivilegeResolver, attach as `privileges`, return.
   *  - On any unrecoverable failure — throw UnauthorizedException so the
   *    Nest exception filter maps to 401 (NOT 500). See (i)'s finding.
   */
  async validate(req: any, payload: ZorbitJwtPayload): Promise<ZorbitJwtPayload> {
    // Older tokens may omit 'type'; accept them for back-compat.
    if (payload.type && payload.type !== 'access') {
      throw new UnauthorizedException('Only access tokens are accepted');
    }

    // Path 1 — legacy fat token: privileges already on payload.
    if (Array.isArray(payload.privileges)) {
      return payload;
    }

    // Path 2 — slim token: resolve hash → privileges.
    if (typeof payload.privilege_set_hash === 'string' && payload.privilege_set_hash.length > 0) {
      // CRITICAL FIX (cycle-105 / SDK 0.5.7) — by-hash self-call detection.
      //
      // Architectural recursion: identity's `GET /api/v1/G/privileges/by-hash/:hash`
      // is decorated with `@UseGuards(ZorbitJwtGuard)`. When a slim-token request
      // hits that endpoint, this strategy's validate() fires; if we then proceed
      // to resolve via `PrivilegeResolver.resolve()`, the resolver HTTP-calls the
      // SAME endpoint, which fires the SAME strategy on the next layer, and so
      // on. Each layer's resolver cache is empty until the outermost call returns
      // — meaning every cold-cache hit triggers an N-deep recursion that times
      // out instead of resolving.
      //
      // Fix: when the incoming request IS the by-hash endpoint, skip privilege
      // resolution entirely. The by-hash controller's own logic doesn't need
      // resolved privileges to do its job — it only needs the JWT signature
      // verified (already done by passport-jwt before validate() is called) and
      // the user.sub / user.org claims (already on the payload). Returning a
      // synthetic empty privileges array short-circuits the recursion at level 1.
      //
      // See soldier (r) finding 2026-04-25 20:23 +07 + soldier (v) fix
      // 2026-04-26 21:18 +07.
      const reqUrl: string =
        (typeof req?.originalUrl === 'string' && req.originalUrl) ||
        (typeof req?.url === 'string' && req.url) ||
        '';
      // Strip query string if present so it doesn't break the regex.
      const pathOnly = reqUrl.split('?')[0];
      // Match both with and without the global API prefix and trailing path-segments.
      // Examples that must match:
      //   /api/v1/G/privileges/by-hash/v1-79f7d68551d0
      //   /api/identity/api/v1/G/privileges/by-hash/v1-abc
      //   /api/v1/G/privileges/by-hash/v1-xyz/
      if (/\/api\/v1\/G\/privileges\/by-hash\/[^/]+\/?$/.test(pathOnly)) {
        // Don't recurse. Return synthetic payload with empty privileges; the
        // by-hash controller does its own re-resolution via AuthService.
        return { ...payload, privileges: [] };
      }

      // Extract raw Bearer token from the request to forward to identity.
      const authHeader: string | undefined = req?.headers?.authorization;
      const bearer =
        typeof authHeader === 'string' && authHeader.toLowerCase().startsWith('bearer ')
          ? authHeader.slice(7).trim()
          : '';
      if (!bearer) {
        // We have a valid slim token but couldn't read the raw Bearer to
        // forward — this would only happen with a non-standard extractor.
        // Rather than 500, deny with 401 so the SPA prompts re-auth.
        throw new UnauthorizedException(
          'Token has privilege_set_hash but Authorization header missing',
        );
      }

      try {
        const privileges = await this.resolver.resolve(
          payload.privilege_set_hash,
          this.identityUrl,
          bearer,
        );
        // Attach as if it were a fat token — guards downstream see no difference.
        return { ...payload, privileges };
      } catch (err) {
        // PrivilegeResolver swallows axios failures and returns []; if we land
        // here, something else went wrong (programming error, OOM, etc.).
        // Map to 401 so misbehaving infra doesn't surface as a 500 to clients.
        this.logger.error(
          `[ZorbitJwtStrategy] privilege resolution threw: ${
            err instanceof Error ? err.message : String(err)
          }`,
        );
        throw new UnauthorizedException('Failed to resolve user privileges');
      }
    }

    // Path 3 — token has neither privileges nor hash. Treat as legacy/empty.
    // Return as-is; ZorbitPrivilegeGuard will deny privilege-gated endpoints
    // with 403 (correct), and auth-only endpoints will pass.
    return payload;
  }
}
