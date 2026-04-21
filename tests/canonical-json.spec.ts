/**
 * Canonical-JSON + HMAC contract tests.
 *
 * These vectors are the authoritative lock-in for the wire format
 * consumed by zorbit-cor-module_registry's HmacValidatorService. If any
 * of these assertions change, every service's announcements break.
 */
import { createHmac } from 'crypto';
import {
  canonicalize,
  canonicalJson,
  signHmac,
  verifyHmac,
} from '../src/canonical-json';
import { normaliseDependenciesV2 } from '../src/dependencies';

const SECRET = 'test-module-secret-for-unit-tests';

describe('canonicalJson', () => {
  it('sorts top-level keys alphabetically', () => {
    expect(canonicalJson({ b: 1, a: 2 })).toBe('{"a":2,"b":1}');
  });

  it('sorts nested-object keys recursively', () => {
    expect(canonicalJson({ outer: { z: 1, a: 2 } })).toBe('{"outer":{"a":2,"z":1}}');
  });

  it('preserves array element order', () => {
    expect(canonicalJson([3, 1, 2])).toBe('[3,1,2]');
  });

  it('sorts inside objects inside arrays', () => {
    expect(canonicalJson([{ b: 1, a: 2 }])).toBe('[{"a":2,"b":1}]');
  });

  it('drops undefined-valued object keys (mirrors JSON.stringify)', () => {
    expect(canonicalJson({ a: 1, b: undefined })).toBe('{"a":1}');
  });

  it('preserves null values', () => {
    expect(canonicalJson({ a: null })).toBe('{"a":null}');
  });

  it('handles deeply-nested objects', () => {
    const v = { x: { y: { z: { a: 1, b: 2 } } } };
    expect(canonicalJson(v)).toBe('{"x":{"y":{"z":{"a":1,"b":2}}}}');
  });

  it('produces identical output regardless of input key order', () => {
    const a = { moduleId: 'm', version: '1', dependencies: { business: [], platform: ['p'] } };
    const b = { dependencies: { platform: ['p'], business: [] }, version: '1', moduleId: 'm' };
    expect(canonicalJson(a)).toBe(canonicalJson(b));
  });

  it('produces the known-good canonical string for a secrets-vault announcement', () => {
    const dependencies = normaliseDependenciesV2({
      requires: ['zorbit-cor-identity'],
      optional: [],
    });
    const payload = {
      dependencies,
      manifestUrl: 'https://zorbit-uat.example/api/secrets-vault/manifest',
      moduleId: 'zorbit-cor-secrets_vault',
      version: '1.0.0',
    };
    expect(canonicalJson(payload)).toBe(
      '{"dependencies":{"business":[],"platform":["zorbit-cor-identity"]},"manifestUrl":"https://zorbit-uat.example/api/secrets-vault/manifest","moduleId":"zorbit-cor-secrets_vault","version":"1.0.0"}',
    );
  });
});

describe('canonicalize (internal shape)', () => {
  it('returns primitive values unchanged', () => {
    expect(canonicalize(1)).toBe(1);
    expect(canonicalize('hi')).toBe('hi');
    expect(canonicalize(true)).toBe(true);
    expect(canonicalize(null)).toBe(null);
  });

  it('returns arrays in order', () => {
    expect(canonicalize([3, 1, 2])).toEqual([3, 1, 2]);
  });
});

describe('signHmac / verifyHmac', () => {
  it('produces a hex digest of length 64', () => {
    const token = signHmac({ a: 1 }, SECRET);
    expect(token).toMatch(/^[0-9a-f]{64}$/);
  });

  it('is deterministic for the same payload + secret', () => {
    const payload = { moduleId: 'x', version: '1' };
    expect(signHmac(payload, SECRET)).toBe(signHmac(payload, SECRET));
  });

  it('changes when any field in the payload changes (tamper-evident)', () => {
    const a = { moduleId: 'x', version: '1' };
    const b = { moduleId: 'x', version: '2' };
    expect(signHmac(a, SECRET)).not.toBe(signHmac(b, SECRET));
  });

  it('does not change when key order changes', () => {
    const a = { moduleId: 'x', version: '1' };
    const b = { version: '1', moduleId: 'x' };
    expect(signHmac(a, SECRET)).toBe(signHmac(b, SECRET));
  });

  it('verifies a token it just produced', () => {
    const payload = { a: 1, b: { c: 2 } };
    const token = signHmac(payload, SECRET);
    expect(verifyHmac(payload, token, SECRET)).toBe(true);
  });

  it('rejects a tampered token', () => {
    const payload = { a: 1 };
    const token = signHmac(payload, SECRET);
    expect(verifyHmac(payload, token.replace(/.$/, '0'), SECRET)).toBe(false);
  });

  it('rejects when the secret differs', () => {
    const payload = { a: 1 };
    const token = signHmac(payload, SECRET);
    expect(verifyHmac(payload, token, 'different-secret')).toBe(false);
  });

  it('rejects when the payload changes', () => {
    const token = signHmac({ a: 1 }, SECRET);
    expect(verifyHmac({ a: 2 }, token, SECRET)).toBe(false);
  });

  it('matches a raw createHmac call on the canonical string', () => {
    const payload = { z: 1, a: 2 };
    const expected = createHmac('sha256', SECRET).update(canonicalJson(payload)).digest('hex');
    expect(signHmac(payload, SECRET)).toBe(expected);
  });
});

describe('normaliseDependenciesV2', () => {
  it('returns empty shape for null/undefined', () => {
    expect(normaliseDependenciesV2(null)).toEqual({ platform: [], business: [] });
    expect(normaliseDependenciesV2(undefined)).toEqual({ platform: [], business: [] });
  });

  it('treats string[] as platform-only', () => {
    expect(normaliseDependenciesV2(['a', 'b'])).toEqual({
      platform: ['a', 'b'],
      business: [],
    });
  });

  it('filters non-string entries in arrays', () => {
    expect(normaliseDependenciesV2(['a', 42, null, 'b'] as unknown)).toEqual({
      platform: ['a', 'b'],
      business: [],
    });
  });

  it('returns empty for non-object, non-array primitives', () => {
    expect(normaliseDependenciesV2(42 as unknown)).toEqual({ platform: [], business: [] });
    expect(normaliseDependenciesV2('hello' as unknown)).toEqual({ platform: [], business: [] });
  });

  it('merges manifest-style {requires, optional} into platform', () => {
    const raw = {
      requires: ['zorbit-cor-identity', 'zorbit-cor-authorization'],
      optional: ['zorbit-cor-audit'],
    };
    expect(normaliseDependenciesV2(raw)).toEqual({
      platform: ['zorbit-cor-identity', 'zorbit-cor-authorization', 'zorbit-cor-audit'],
      business: [],
    });
  });

  it('routes a `business` key into the business bucket', () => {
    const raw = {
      platform: ['zorbit-cor-identity'],
      business: ['zorbit-app-pcg4'],
    };
    expect(normaliseDependenciesV2(raw)).toEqual({
      platform: ['zorbit-cor-identity'],
      business: ['zorbit-app-pcg4'],
    });
  });

  it('preserves v2 shape exactly (no-op)', () => {
    const v2 = { platform: ['a'], business: ['b'] };
    expect(normaliseDependenciesV2(v2)).toEqual(v2);
  });

  it('filters non-array values in objects', () => {
    const raw = { platform: ['a'], bogus: 'nope', business: ['b'] };
    expect(normaliseDependenciesV2(raw)).toEqual({
      platform: ['a'],
      business: ['b'],
    });
  });
});
