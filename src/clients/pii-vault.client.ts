import axios, { AxiosInstance } from 'axios';

/**
 * Configuration for the PII Vault client.
 */
export interface PiiVaultClientConfig {
  /** PII Vault service URL (e.g. http://localhost:3105) */
  piiVaultUrl: string;
  /** Default organization hash ID */
  defaultOrgHashId?: string;
  /** Request timeout in ms (default: 5000) */
  timeout?: number;
}

/**
 * Result of a tokenize operation.
 */
export interface TokenizeResult {
  token: string;
  fieldName: string;
  piiType: string;
}

/**
 * Result of a detokenize (reveal) operation.
 */
export interface RevealResult {
  token: string;
  value: string;
  piiType: string;
}

/**
 * High-level client for the Zorbit PII Vault service.
 *
 * Provides simple tokenize/detokenize methods for business modules.
 * Handles JWT forwarding and organization context automatically.
 *
 * @example
 * ```typescript
 * import { PiiVaultClient } from '@zorbit-platform/sdk-node';
 *
 * const pii = new PiiVaultClient({
 *   piiVaultUrl: 'http://localhost:3105',
 *   defaultOrgHashId: 'O-92AF',
 * });
 *
 * // Tokenize a value
 * const token = await pii.tokenize('john@example.com', 'email', 'email', jwtToken);
 * // 'PII-A1B2'
 *
 * // Reveal a token
 * const value = await pii.reveal(token, 'O-92AF', jwtToken);
 * // 'john@example.com'
 *
 * // Bulk tokenize
 * const tokens = await pii.tokenizeBulk([
 *   { value: 'John', fieldName: 'firstName', piiType: 'name' },
 *   { value: 'john@example.com', fieldName: 'email', piiType: 'email' },
 * ], jwtToken);
 * ```
 */
export class PiiVaultClient {
  private client: AxiosInstance;
  private defaultOrgHashId?: string;

  constructor(config: PiiVaultClientConfig) {
    this.defaultOrgHashId = config.defaultOrgHashId;
    this.client = axios.create({
      baseURL: config.piiVaultUrl,
      timeout: config.timeout ?? 5000,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  /**
   * Tokenize a single PII value.
   *
   * @param value - The raw PII value to tokenize
   * @param fieldName - Field name for context (e.g. 'email', 'firstName')
   * @param piiType - PII classification (e.g. 'email', 'phone', 'name')
   * @param authToken - JWT bearer token for authentication
   * @param orgHashId - Organization context (uses default if not provided)
   * @returns The PII token string
   */
  async tokenize(
    value: string,
    fieldName: string,
    piiType: string,
    authToken: string,
    orgHashId?: string,
  ): Promise<string> {
    const org = orgHashId ?? this.defaultOrgHashId;
    if (!org) throw new Error('orgHashId is required for tokenization');

    const response = await this.client.post(
      '/api/v1/pii/tokenize',
      { organizationHashId: org, fieldName, value, piiType },
      { headers: { Authorization: `Bearer ${authToken}` } },
    );

    return response.data?.token ?? response.data?.data;
  }

  /**
   * Reveal (detokenize) a PII token back to its original value.
   *
   * @param token - The PII token to reveal
   * @param orgHashId - Organization context
   * @param authToken - JWT bearer token for authentication
   * @returns The original PII value
   */
  async reveal(
    token: string,
    orgHashId: string | undefined,
    authToken: string,
  ): Promise<string> {
    const org = orgHashId ?? this.defaultOrgHashId;
    if (!org) throw new Error('orgHashId is required for reveal');

    const response = await this.client.post(
      `/api/v1/O/${org}/pii/reveal`,
      { token },
      { headers: { Authorization: `Bearer ${authToken}` } },
    );

    return response.data?.value ?? response.data?.data;
  }

  /**
   * Tokenize multiple PII values in a single batch.
   *
   * @param items - Array of { value, fieldName, piiType }
   * @param authToken - JWT bearer token
   * @param orgHashId - Organization context
   * @returns Array of TokenizeResult
   */
  async tokenizeBulk(
    items: Array<{ value: string; fieldName: string; piiType: string }>,
    authToken: string,
    orgHashId?: string,
  ): Promise<TokenizeResult[]> {
    const results: TokenizeResult[] = [];
    for (const item of items) {
      const token = await this.tokenize(
        item.value,
        item.fieldName,
        item.piiType,
        authToken,
        orgHashId,
      );
      results.push({ token, fieldName: item.fieldName, piiType: item.piiType });
    }
    return results;
  }

  /**
   * Reveal multiple PII tokens in a single batch.
   *
   * @param tokens - Array of PII tokens to reveal
   * @param authToken - JWT bearer token
   * @param orgHashId - Organization context
   * @returns Map of token -> original value
   */
  async revealBulk(
    tokens: string[],
    authToken: string,
    orgHashId?: string,
  ): Promise<Map<string, string>> {
    const results = new Map<string, string>();
    for (const token of tokens) {
      try {
        const value = await this.reveal(token, orgHashId, authToken);
        results.set(token, value);
      } catch {
        // Skip tokens that fail to reveal (may be invalid or expired)
        results.set(token, token);
      }
    }
    return results;
  }
}
