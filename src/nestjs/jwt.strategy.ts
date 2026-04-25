import { Injectable, UnauthorizedException } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { ConfigService } from '@nestjs/config';

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
 * Register via ZorbitAuthModule or directly in your module's providers:
 *   { provide: 'JWT_STRATEGY', useClass: ZorbitJwtStrategy }
 */
@Injectable()
export class ZorbitJwtStrategy extends PassportStrategy(Strategy, 'jwt') {
  constructor(configService: ConfigService) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: configService.get<string>('JWT_SECRET', 'dev-secret-change-in-production'),
    });
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
