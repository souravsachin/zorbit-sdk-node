import * as crypto from 'crypto';

/**
 * Generate a short hash identifier with the given prefix.
 *
 * Format: PREFIX-XXXX where XXXX is a 4-character uppercase hex string.
 *
 * @param prefix - Identifier prefix (e.g. 'U', 'O', 'EV', 'DOC')
 * @returns Generated hash ID (e.g. 'U-81F3', 'EV-883A')
 */
export function generateHashId(prefix: string): string {
  const bytes = crypto.randomBytes(2);
  const hex = bytes.toString('hex').toUpperCase();
  return `${prefix}-${hex}`;
}

/**
 * Validate a short hash identifier.
 *
 * @param id - The identifier to validate
 * @param prefix - Optional prefix to match against
 * @returns True if the identifier is valid
 */
export function validateHashId(id: string, prefix?: string): boolean {
  if (!id || typeof id !== 'string') return false;

  const pattern = prefix
    ? new RegExp(`^${escapeRegExp(prefix)}-[0-9A-F]{4}$`)
    : /^[A-Z]+-[0-9A-F]{4}$/;

  return pattern.test(id);
}

function escapeRegExp(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
