/**
 * Manifest dependency normalisation helpers.
 *
 * Zorbit manifests may declare dependencies in several legacy shapes:
 *   - string[]                                     (v0, pre-split)
 *   - { platform: [], business: [] }               (v2 — canonical)
 *   - { requires: [], optional: [] }               (manifest-style v1)
 *   - any other object keyed by category           (future-proofed)
 *
 * The module registry validates HMAC signatures against the v2 object
 * shape. Producers MUST normalise their manifest's dependencies into
 * `{ platform: string[], business: string[] }` before signing, otherwise
 * the registry will reject the announcement.
 */

export interface DependenciesV2 {
  platform: string[];
  business: string[];
}

/**
 * Normalise an arbitrary dependency declaration into the v2 object shape.
 *
 * Rules:
 *   - null/undefined      → { platform: [], business: [] }
 *   - string[]            → { platform: [...strings], business: [] }
 *   - non-object/array    → { platform: [], business: [] }
 *   - object with arrays  → keys whose name === 'business' go into business;
 *                           every other key's strings go into platform
 *
 * The manifest-style `{ requires, optional }` shape therefore merges into
 * `platform`. This mirrors the behaviour that was duplicated across 22
 * backend services prior to the SDK extraction.
 */
export function normaliseDependenciesV2(raw: unknown): DependenciesV2 {
  if (raw === null || raw === undefined) {
    return { platform: [], business: [] };
  }
  if (Array.isArray(raw)) {
    return {
      platform: raw.filter((x): x is string => typeof x === 'string'),
      business: [],
    };
  }
  if (typeof raw !== 'object') {
    return { platform: [], business: [] };
  }
  const obj = raw as Record<string, unknown>;
  const platform: string[] = [];
  const business: string[] = [];
  for (const key of Object.keys(obj)) {
    const val = obj[key];
    if (!Array.isArray(val)) continue;
    const items = val.filter((x): x is string => typeof x === 'string');
    if (key === 'business') {
      business.push(...items);
    } else {
      platform.push(...items);
    }
  }
  return { platform, business };
}
