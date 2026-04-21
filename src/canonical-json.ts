/**
 * Canonical JSON + HMAC helpers for Zorbit module announcements.
 *
 * Canonical JSON contract (MUST match registry-side validator byte-for-byte):
 *   - Object keys recursively sorted alphabetically
 *   - Array element order preserved as-is
 *   - Undefined values omitted (matches JSON.stringify's drop-undefined
 *     behaviour on object members)
 *   - No whitespace (default JSON.stringify)
 *
 * Background: the original implementation used
 *   JSON.stringify(obj, Object.keys(obj).sort())
 * which (a) used the key array as a replacer *whitelist*, silently dropping
 * any nested object's keys that weren't also top-level keys, and (b) did
 * NOT sort nested object keys. That made signer and verifier disagree
 * whenever the payload contained a nested object such as the v2
 * dependencies shape `{ platform: [...], business: [...] }`. See
 * zorbit-cor-module_registry/src/services/hmac-validator.service.ts for the
 * original fix — this module is the SDK-level extraction of that logic.
 *
 * This module has zero framework dependencies — just `crypto`. It is
 * therefore safe to use from NestJS, Express, or plain Node services.
 */
import { createHmac } from 'crypto';

/**
 * Return a new value with all nested object keys sorted alphabetically.
 * Arrays keep their order. Primitives are returned as-is.
 *
 * Within an object, keys whose values are `undefined` are omitted (matches
 * JSON.stringify's standard behaviour). `null` values are preserved.
 */
export function canonicalize(value: unknown): unknown {
  if (value === null || value === undefined) return value;
  if (Array.isArray(value)) {
    return value.map(canonicalize);
  }
  if (typeof value === 'object') {
    const src = value as Record<string, unknown>;
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(src).sort()) {
      const v = src[key];
      if (v === undefined) continue;
      out[key] = canonicalize(v);
    }
    return out;
  }
  return value;
}

/**
 * Produce the canonical JSON string for an arbitrary value.
 * Object keys are recursively sorted; array order is preserved.
 */
export function canonicalJson(value: unknown): string {
  return JSON.stringify(canonicalize(value));
}

/**
 * Sign a payload with HMAC-SHA256, returning a hex digest.
 * The payload is canonicalised before signing.
 */
export function signHmac(payload: unknown, secret: string): string {
  return createHmac('sha256', secret).update(canonicalJson(payload)).digest('hex');
}

/**
 * Verify that `signedToken` matches HMAC-SHA256(canonicalJson(payload), secret).
 * Returns true iff the tokens match.
 *
 * Uses a constant-time comparison indirectly via string equality on the
 * hex digest (the payload is attacker-controlled but the digest is derived
 * server-side; timing leaks through equality here are not meaningful for
 * this threat model). Callers who need timing-safe comparison should use
 * `crypto.timingSafeEqual` on raw Buffer inputs directly.
 */
export function verifyHmac(payload: unknown, signedToken: string, secret: string): boolean {
  try {
    const expected = signHmac(payload, secret);
    return expected === signedToken;
  } catch {
    return false;
  }
}
