/**
 * Wildcard privilege interpreter — slim-JWT companion.
 *
 * Cycle 103 (owner directive 2026-04-25, MSG-037) shrank the JWT payload from
 * ~9 KB (every privilege code expanded as an explicit string) to ~600 B by
 * keeping only the user's role + a small set of wildcard claims on the token.
 *
 * Backend services that previously did `user.privileges.includes('foo.bar.baz')`
 * must now also accept a wildcard match — e.g. a JWT carrying
 * `platform.admin.all` should pass any `platform.*.*` check.
 *
 * Pattern grammar:
 *   - dot-separated segments: "module.resource.action"
 *   - "*" matches any single segment (no dot inside)
 *   - "**" or a pattern ending in ".all" matches any number of segments
 *
 * Examples:
 *   matchWildcard('platform.admin.all',     'datatable.page.create')      → true
 *   matchWildcard('business.*.read',        'business.broker.read')       → true
 *   matchWildcard('business.*.read',        'business.broker.write')      → false
 *   matchWildcard('platform.**',            'platform.audit.view.deep')   → true
 *
 * The interpreter is intentionally tiny (no regex backtracking concerns) so it
 * is safe to call on the request hot path. ZorbitPrivilegeGuard delegates to
 * `hasPrivilege` instead of plain Set.has() so that a 600-byte JWT continues
 * to authorise every endpoint that the 9 KB JWT used to.
 */

import type { ZorbitJwtPayload } from '../types/jwt-payload';

/** Wildcards a token may carry. Currently only string codes; reserved for future expansion. */
export type Wildcard = string;

/**
 * Test whether a single wildcard pattern matches a target privilege code.
 *
 * Exported for unit testing; downstream code should prefer `hasPrivilege`.
 */
export function matchWildcard(pattern: string, target: string): boolean {
  if (!pattern || !target) return false;
  if (pattern === target) return true;

  // ".all" suffix → super-admin style global wildcard. Per owner contract
  // (MSG-037, 2026-04-25): "'platform.admin.all' matches anything". This
  // mirrors the reference snippet in the cycle-103 brief.
  if (pattern.endsWith('.all')) {
    return true;
  }

  // Build a regex: '.' literal, '**' → '.+', '*' → '[^.]+'
  const re = new RegExp(
    '^' +
      pattern
        .split('.')
        .map((seg) => {
          if (seg === '**') return '.+';
          if (seg === '*') return '[^.]+';
          return seg.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        })
        .join('\\.') +
      '$',
  );
  return re.test(target);
}

/**
 * Check whether a JWT's explicit privileges OR carried wildcards satisfy a
 * required privilege code.
 *
 * Order of evaluation (cheapest first):
 *   1. legacy explicit privileges array (back-compat with pre-slim JWTs)
 *   2. wildcards array (slim-JWT carriers)
 *   3. legacy `platform.superadmin.bypass` token claim
 *
 * Returns false if the JWT carries neither — the caller may then fall back
 * to a Redis/cache lookup against the cached full privilege list.
 */
export function hasPrivilege(
  jwt: Pick<ZorbitJwtPayload, 'privileges' | 'wildcards' | 'role'> & {
    wildcards?: string[];
  },
  required: string,
): boolean {
  if (!required) return true;

  // 1. Explicit privilege array (legacy fat JWT path)
  if (Array.isArray(jwt.privileges) && jwt.privileges.length > 0) {
    if (jwt.privileges.includes(required)) return true;
    // Also honour wildcards that may have been stored in the privileges array
    for (const p of jwt.privileges) {
      if (p.includes('*') || p.endsWith('.all')) {
        if (matchWildcard(p, required)) return true;
      }
    }
  }

  // 2. Wildcards array (slim JWT path)
  if (Array.isArray(jwt.wildcards)) {
    for (const w of jwt.wildcards) {
      if (matchWildcard(w, required)) return true;
    }
  }

  return false;
}

/**
 * Check that a JWT satisfies ALL of a list of required privileges.
 * Convenience wrapper used by ZorbitPrivilegeGuard.
 */
export function hasAllPrivileges(
  jwt: Pick<ZorbitJwtPayload, 'privileges' | 'wildcards' | 'role'> & {
    wildcards?: string[];
  },
  required: string[],
): boolean {
  if (!required || required.length === 0) return true;
  return required.every((r) => hasPrivilege(jwt, r));
}
