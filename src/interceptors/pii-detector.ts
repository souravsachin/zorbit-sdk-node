import axios from 'axios';
import { generateHashId } from '../utils/hash-id';

/**
 * A pattern definition for detecting PII in field names and/or values.
 */
export interface PIIPattern {
  /** Regex to match against field names */
  fieldPattern: RegExp;
  /** Optional regex to match against field values */
  valuePattern?: RegExp;
  /** PII classification type */
  piiType: string;
}

/**
 * Configuration for the PII auto-detection interceptor.
 */
export interface PIIDetectorConfig {
  /** PII Vault service URL (e.g. http://localhost:3105) */
  piiVaultUrl: string;
  /** Organization hash ID for tokenization context */
  orgHashId: string;
  /** Enable or disable detection (default: true) */
  enabled: boolean;
  /** Additional patterns to check beyond built-in ones */
  additionalPatterns?: PIIPattern[];
  /** JWT token for authenticating with the PII Vault */
  authToken?: string;
  /** Fields to explicitly skip (even if they match patterns) */
  skipFields?: string[];
}

/**
 * Result of scanning a single field for PII.
 */
export interface PIIDetection {
  field: string;
  originalValue: string;
  piiType: string;
  token: string;
}

/**
 * Built-in PII detection patterns that are always active.
 *
 * Two categories:
 * 1. Field name patterns - match common PII field naming conventions
 * 2. Value patterns - match PII data formats regardless of field name
 */
export const BUILTIN_PATTERNS: PIIPattern[] = [
  // Field name patterns
  { fieldPattern: /email/i, piiType: 'email' },
  { fieldPattern: /phone|mobile|tel/i, piiType: 'phone' },
  { fieldPattern: /aadhaar|emirates.?id|ssn|passport|national.?id/i, piiType: 'national_id' },
  { fieldPattern: /first.?name|last.?name|full.?name|display.?name/i, piiType: 'name' },
  { fieldPattern: /address|street|city|postal|zip/i, piiType: 'address' },
  { fieldPattern: /date.?of.?birth|dob|birth.?date/i, piiType: 'dob' },
  { fieldPattern: /bank.?account|card.?number|iban|routing/i, piiType: 'financial' },

  // Value patterns (match any field name, detect by value format)
  {
    fieldPattern: /.*/,
    valuePattern: /^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/,
    piiType: 'email',
  },
  {
    fieldPattern: /.*/,
    valuePattern: /^\+?[1-9]\d{1,14}$/,
    piiType: 'phone',
  },
  {
    fieldPattern: /.*/,
    valuePattern: /^\d{3}-\d{2}-\d{4}$/,
    piiType: 'national_id', // SSN
  },
  {
    fieldPattern: /.*/,
    valuePattern: /^\d{4}\s?\d{4}\s?\d{4}$/,
    piiType: 'national_id', // Aadhaar
  },
];

/**
 * Scan a flat or nested object for PII fields.
 * Returns an array of detected PII matches (field path, value, type).
 * Does NOT call the vault - pure detection only.
 */
export function detectPII(
  data: Record<string, unknown>,
  patterns: PIIPattern[],
  skipFields: string[] = [],
  _prefix: string = '',
): PIIDetection[] {
  const detections: PIIDetection[] = [];

  for (const [key, value] of Object.entries(data)) {
    const fullPath = _prefix ? `${_prefix}.${key}` : key;

    if (skipFields.includes(fullPath) || skipFields.includes(key)) {
      continue;
    }

    // Recurse into nested objects (but not arrays or null)
    if (value !== null && typeof value === 'object' && !Array.isArray(value)) {
      detections.push(
        ...detectPII(value as Record<string, unknown>, patterns, skipFields, fullPath),
      );
      continue;
    }

    // Only scan string values
    if (typeof value !== 'string') continue;

    // Skip values that look like existing PII tokens
    if (/^PII-[0-9A-F]{4}$/i.test(value)) continue;

    for (const pattern of patterns) {
      const fieldMatches = pattern.fieldPattern.test(key);
      const valueMatches = pattern.valuePattern ? pattern.valuePattern.test(value) : false;

      // For field-name-only patterns (no valuePattern), match on field name
      // For value patterns (with valuePattern), both field and value must match
      if (pattern.valuePattern) {
        if (fieldMatches && valueMatches) {
          detections.push({
            field: fullPath,
            originalValue: value,
            piiType: pattern.piiType,
            token: '', // filled after vault call
          });
          break; // one match per field is enough
        }
      } else {
        if (fieldMatches) {
          detections.push({
            field: fullPath,
            originalValue: value,
            piiType: pattern.piiType,
            token: '',
          });
          break;
        }
      }
    }
  }

  return detections;
}

/**
 * Tokenize a single value via the PII Vault API.
 */
async function tokenizeValue(
  piiVaultUrl: string,
  orgHashId: string,
  fieldName: string,
  value: string,
  piiType: string,
  authToken?: string,
): Promise<string> {
  try {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    };
    if (authToken) {
      headers['Authorization'] = `Bearer ${authToken}`;
    }

    const response = await axios.post(
      `${piiVaultUrl}/api/v1/pii/tokenize`,
      {
        organizationHashId: orgHashId,
        fieldName,
        value,
        piiType,
      },
      { headers },
    );

    return response.data?.token || `PII-${generateHashId('PII').split('-')[1]}`;
  } catch (_error) {
    // If vault is unreachable, generate a local placeholder token
    // This prevents data loss but logs a warning
    console.warn(
      `[zorbit-sdk] PII Vault unreachable for field "${fieldName}". Using placeholder token.`,
    );
    return `PII-${generateHashId('PII').split('-')[1]}`;
  }
}

/**
 * Set a nested value in an object by dot-separated path.
 */
function setNestedValue(obj: Record<string, unknown>, path: string, value: unknown): void {
  const parts = path.split('.');
  let current: Record<string, unknown> = obj;
  for (let i = 0; i < parts.length - 1; i++) {
    current = current[parts[i]] as Record<string, unknown>;
  }
  current[parts[parts.length - 1]] = value;
}

/**
 * Create a PII detection and tokenization function.
 *
 * Returns a function that:
 * 1. Scans an object for PII fields (by name and value patterns)
 * 2. Calls the PII Vault to tokenize detected values
 * 3. Returns the object with PII replaced by tokens
 *
 * @example
 * ```typescript
 * const piiDetector = createPIIDetector({
 *   piiVaultUrl: 'http://localhost:3105',
 *   orgHashId: 'O-92AF',
 *   enabled: true,
 * });
 *
 * const safeData = await piiDetector({
 *   firstName: 'John',
 *   email: 'john@example.com',
 *   accountNumber: '12345',
 * });
 * // { firstName: 'PII-A1B2', email: 'PII-C3D4', accountNumber: '12345' }
 * ```
 */
export function createPIIDetector(config: PIIDetectorConfig) {
  const allPatterns = [...BUILTIN_PATTERNS, ...(config.additionalPatterns || [])];
  const skipFields = config.skipFields || [];

  return async function scanAndTokenize<T extends Record<string, unknown>>(
    data: T,
  ): Promise<{ data: T; detections: PIIDetection[] }> {
    if (!config.enabled) {
      return { data, detections: [] };
    }

    // Deep clone to avoid mutating the original
    const cloned = JSON.parse(JSON.stringify(data)) as T;

    const detections = detectPII(cloned, allPatterns, skipFields);

    // Tokenize all detected PII values
    for (const detection of detections) {
      const token = await tokenizeValue(
        config.piiVaultUrl,
        config.orgHashId,
        detection.field,
        detection.originalValue,
        detection.piiType,
        config.authToken,
      );
      detection.token = token;
      setNestedValue(cloned as Record<string, unknown>, detection.field, token);
    }

    return { data: cloned, detections };
  };
}
