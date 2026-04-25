/**
 * Canonical JWT payload shape issued by zorbit-cor-identity.
 *
 * Superset of what each individual service's local JwtPayload shape
 * declared. Downstream services narrow this to the fields they use.
 *
 * Keep aligned with zorbit-sdk-node/src/nestjs/jwt.strategy.ts.
 *
 * Cycle 103 (2026-04-25, MSG-037) — slim JWT contract:
 *   - `privileges` is now OPTIONAL and may be empty / omitted.
 *     The full privilege list lives in the session cache (Redis or
 *     in-memory) keyed by `sid`, and is also fetched by the SPA into
 *     localStorage at login time.
 *   - `wildcards` is the authoritative list of broad claims (e.g.
 *     `platform.admin.all`, `business.*.read`). Slim JWTs from
 *     identity-service carry this and `role` only.
 *   - `sid` is the session id used to look up cached state from
 *     `GET /api/identity/api/v1/U/<sub>/session/<sid>`.
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
  /**
   * Explicit privilege codes assigned via roles at login time.
   * SLIM JWT (cycle 103+): typically empty — fetch from session cache instead.
   * FAT JWT (legacy): full expansion of the user's role's privileges.
   */
  privileges?: string[];
  /**
   * Wildcard privilege claims carried on the token. Cheap to evaluate
   * via the SDK's `hasPrivilege` interpreter.
   * Examples: 'platform.admin.all', 'business.*.read'.
   */
  wildcards?: string[];
  /** Session id — opaque pointer to the cached privilege/menu/org bundle. */
  sid?: string;
  /** Legacy role field — prefer privileges; retained for back-compat */
  role?: string;
  /** Token type — only 'access' tokens are valid for API requests */
  type: 'access' | 'refresh' | 'mfa_temp';
  /** Issued-at (unix seconds) — filled by jsonwebtoken */
  iat?: number;
  /** Expiry (unix seconds) — filled by jsonwebtoken */
  exp?: number;
}
