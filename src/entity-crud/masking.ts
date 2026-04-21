/**
 * Role-per-column masking.
 *
 * Apply a list of `MaskingRule`s to an object (or array of objects) as
 * they leave the SDK's controller factory. A rule masks a field unless
 * ANY of its `unlessPrivilege` / `unlessRole` conditions is satisfied by
 * the current user.
 *
 * Rule semantics (owner 2026-04-22):
 *   mask applied  ⇔  user lacks unlessPrivilege AND user's role is not in unlessRole
 *   either unless-clause being satisfied → field is returned unmasked.
 */
import type { MaskingRule } from './entity-schema';

export interface MaskingContext {
  /** Role claim from JWT (single string); used for role-based bypass */
  role?: string | null;
  /** Privilege codes from JWT */
  privileges?: string[];
}

/**
 * Returns true if the rule should mask this field for the given user.
 */
export function shouldMask(rule: MaskingRule, ctx: MaskingContext): boolean {
  const privs = new Set(ctx.privileges || []);
  // If the user has the unless privilege → NOT masked
  if (rule.unlessPrivilege && privs.has(rule.unlessPrivilege)) {
    return false;
  }
  // If the user's role is in the unless role list → NOT masked
  if (
    rule.unlessRole &&
    ctx.role &&
    rule.unlessRole.includes(ctx.role)
  ) {
    return false;
  }
  return true;
}

/**
 * Apply a pattern/replacement regex to a single scalar value.
 * Non-strings are returned unchanged.
 */
export function applyPattern(
  value: unknown,
  pattern: string,
  replacement: string,
): unknown {
  if (value === null || value === undefined) return value;
  if (typeof value !== 'string') return value;
  try {
    // `pattern` is author-supplied JSON. Escaping is their responsibility.
    return value.replace(new RegExp(pattern), replacement);
  } catch {
    return value;
  }
}

/**
 * Apply every applicable masking rule to a single row in place and
 * return the masked row (same reference).
 */
export function maskRow<T extends Record<string, unknown>>(
  row: T,
  rules: MaskingRule[],
  ctx: MaskingContext,
): T {
  for (const r of rules) {
    if (!shouldMask(r, ctx)) continue;
    if (!(r.field in row)) continue;
    row[r.field as keyof T] = applyPattern(
      row[r.field],
      r.pattern,
      r.replacement,
    ) as T[keyof T];
  }
  return row;
}

/**
 * Apply masking rules to an array of rows. Returns a new array of
 * mutated copies.
 */
export function maskRows<T extends Record<string, unknown>>(
  rows: T[],
  rules: MaskingRule[],
  ctx: MaskingContext,
): T[] {
  if (!rules.length) return rows;
  return rows.map((r) => maskRow({ ...r }, rules, ctx));
}
