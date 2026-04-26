/**
 * Options for ZorbitAuthModule.forRoot().
 *
 * Kept in a separate file so the strategy can `@Inject(ZORBIT_AUTH_OPTIONS)`
 * without a circular import to the module file.
 */

export const ZORBIT_AUTH_OPTIONS = Symbol('ZORBIT_AUTH_OPTIONS');

export interface ZorbitAuthOptions {
  /**
   * The JWT signing secret — must match the secret zorbit-identity uses to
   * mint access tokens. Pass via process.env.JWT_SECRET.
   *
   * Never hardcode in source.
   */
  jwtSecret: string;

  /**
   * Reserved for future use (v0.6.0+):
   *
   * - `validatePayload` — custom payload-validation hook (e.g. database lookup
   *   when slim-JWT migration lands)
   * - `algorithms`      — allow asymmetric signing once RS256/EdDSA support
   *   ships
   *
   * Not implemented today; declared so adding them later is a non-breaking
   * change.
   */
}
