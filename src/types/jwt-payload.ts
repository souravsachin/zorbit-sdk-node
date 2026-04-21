/**
 * Canonical JWT payload shape issued by zorbit-cor-identity.
 *
 * Superset of what each individual service's local JwtPayload shape
 * declared. Downstream services narrow this to the fields they use.
 *
 * Keep aligned with zorbit-sdk-node/src/nestjs/jwt.strategy.ts.
 */
export interface ZorbitJwtPayload {
  /** User short hash ID, e.g. 'U-81F3' */
  sub: string;
  /** Organization short hash ID, e.g. 'O-92AF' */
  org: string;
  /** Display name for UI */
  displayName?: string;
  /** Email token (PII-tokenized) */
  email?: string;
  /** Privilege codes assigned via roles at login time */
  privileges?: string[];
  /** Legacy role field — prefer privileges; retained for back-compat */
  role?: string;
  /** Token type — only 'access' tokens are valid for API requests */
  type: 'access' | 'refresh' | 'mfa_temp';
  /** Issued-at (unix seconds) — filled by jsonwebtoken */
  iat?: number;
  /** Expiry (unix seconds) — filled by jsonwebtoken */
  exp?: number;
}
