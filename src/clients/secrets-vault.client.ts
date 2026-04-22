import axios, { AxiosInstance, AxiosError } from 'axios';
import { existsSync, readFileSync } from 'fs';

/**
 * Configuration for {@link SecretsVaultClient}.
 */
export interface SecretsVaultClientConfig {
  /** Full URL to the secrets-vault service (e.g. http://localhost:3038
   *  or https://zorbit-uat.onezippy.ai). The module's platform-scope
   *  REST base is `{baseUrl}{apiPathPrefix}/api/v1/G/secrets`. */
  baseUrl: string;
  /**
   * Prefix in front of the `/api/v1/G/...` path. Defaults to
   * `/api/secrets_vault` so the client works behind the standard nginx
   * route. Pass an empty string to hit the service directly on its
   * own port (localhost dev / init-containers on the internal docker
   * network).
   */
  apiPathPrefix?: string;
  /**
   * Bearer token to authenticate. If omitted, the client looks at:
   *   1. opts.tokenPath  (explicit path)
   *   2. ZORBIT_VAULT_TOKEN  env var
   *   3. /opt/zorbit-platform/secrets_vault/bootstrap.jwt  (default path)
   */
  token?: string;
  /** Override the filesystem path that holds the bootstrap JWT. */
  tokenPath?: string;
  /** Request timeout in ms. Default: 5000. */
  timeout?: number;
}

export interface VaultSecretMeta {
  key: string;
  version: number;
  createdAt: string;
  description: string | null;
  owningModule: string | null;
}

export interface VaultSecretValue {
  key: string;
  value: string;
  version: number;
  createdAt: string;
  description: string | null;
}

export interface VaultSecretVersion {
  version: number;
  createdAt: string;
  activeUntil: string | null;
  createdBy: string;
  rotatedFrom: number | null;
}

export interface VaultWriteResult {
  key: string;
  version: number;
  createdAt: string;
  actor: string;
}

export interface VaultRotateResult extends VaultWriteResult {
  rotatedFrom: number;
}

/**
 * Client for the Zorbit Platform Secrets Vault.
 *
 * Auth:
 *   - Explicit `token` option, or
 *   - `ZORBIT_VAULT_TOKEN` env var, or
 *   - bootstrap JWT file at /opt/zorbit-platform/secrets_vault/bootstrap.jwt
 *     (mode 0400, dropped by the vault itself on first boot).
 *
 * Usage:
 * ```ts
 * import { SecretsVaultClient } from '@zorbit-platform/sdk-node';
 *
 * const vault = new SecretsVaultClient({
 *   baseUrl: 'http://zu-secrets_vault:3038',
 *   apiPathPrefix: '',  // hit service directly; no nginx layer
 * });
 *
 * await vault.put('platform.zorbit-cor-identity.credentials.db-main',
 *                 'postgres://user:pass@host:5432/db');
 * const uri = await vault.get('platform.zorbit-cor-identity.credentials.db-main');
 * ```
 *
 * Key-format note: vault keys follow the
 * `platform.<owning-module>.<category>.<specifier>` grammar. The
 * shorter `zorbit-dev/mongo/uri` style used in the
 * `zorbit:vault:<namespace>` resolver expression is normalised to
 * this form by the resolver script before it hits the vault.
 */
export class SecretsVaultClient {
  private readonly http: AxiosInstance;
  private readonly tokenSource: () => string;

  constructor(config: SecretsVaultClientConfig) {
    const prefix =
      config.apiPathPrefix === undefined
        ? '/api/secrets_vault'
        : config.apiPathPrefix;
    // Normalise: baseUrl ends without trailing slash, prefix starts with / or empty.
    const baseURL = `${config.baseUrl.replace(/\/+$/, '')}${prefix}`;

    this.http = axios.create({
      baseURL,
      timeout: config.timeout ?? 5000,
      headers: { 'Content-Type': 'application/json' },
    });

    // Resolve token lazily so file-based bootstrap JWT drops between
    // constructor and first call still work.
    const resolve = (): string => {
      if (config.token && config.token.trim().length > 0) return config.token;
      const envTok = process.env.ZORBIT_VAULT_TOKEN;
      if (envTok && envTok.trim().length > 0) return envTok.trim();
      const path =
        config.tokenPath ??
        '/opt/zorbit-platform/secrets_vault/bootstrap.jwt';
      if (existsSync(path)) {
        return readFileSync(path, 'utf8').trim();
      }
      throw new Error(
        `SecretsVaultClient: no token available. Set the token option, ` +
          `ZORBIT_VAULT_TOKEN env var, or drop a bootstrap JWT at ${path}.`,
      );
    };
    this.tokenSource = resolve;
  }

  /**
   * Create or update a secret (idempotent — second call bumps version).
   */
  async put(
    key: string,
    value: string,
    description?: string,
  ): Promise<VaultWriteResult> {
    return this.request<VaultWriteResult>('POST', '/api/v1/G/secrets', {
      key,
      value,
      description: description ?? null,
    });
  }

  /**
   * Read the decrypted value of a secret. Returns `null` if the secret
   * does not exist (404 swallowed) — all other errors throw. Use
   * {@link getOrThrow} if you'd rather a 404 surface.
   */
  async get(
    key: string,
    version?: number,
  ): Promise<string | null> {
    try {
      const body = await this.getOrThrow(key, version);
      return body.value;
    } catch (err) {
      if (this.isNotFound(err)) return null;
      throw err;
    }
  }

  async getOrThrow(
    key: string,
    version?: number,
  ): Promise<VaultSecretValue> {
    const qs = version ? `?version=${version}` : '';
    return this.request<VaultSecretValue>(
      'GET',
      `/api/v1/G/secrets/${encodeURIComponent(key)}${qs}`,
    );
  }

  /**
   * List secrets (metadata only — no values).
   */
  async list(prefix?: string): Promise<VaultSecretMeta[]> {
    const qs = prefix ? `?prefix=${encodeURIComponent(prefix)}` : '';
    return this.request<VaultSecretMeta[]>(
      'GET',
      `/api/v1/G/secrets${qs}`,
    );
  }

  /**
   * Rotate — writes a new version, keeps the old one retrievable.
   */
  async rotate(key: string, newValue: string): Promise<VaultRotateResult> {
    return this.request<VaultRotateResult>(
      'PATCH',
      `/api/v1/G/secrets/${encodeURIComponent(key)}`,
      { value: newValue },
    );
  }

  async triggerRotation(
    key: string,
    newValue: string,
  ): Promise<VaultRotateResult> {
    return this.request<VaultRotateResult>(
      'POST',
      `/api/v1/G/secrets/${encodeURIComponent(key)}/rotations`,
      { value: newValue },
    );
  }

  async listVersions(key: string): Promise<VaultSecretVersion[]> {
    return this.request<VaultSecretVersion[]>(
      'GET',
      `/api/v1/G/secrets/${encodeURIComponent(key)}/versions`,
    );
  }

  async softDelete(key: string): Promise<{ key: string; deletedAt: string }> {
    return this.request('DELETE', `/api/v1/G/secrets/${encodeURIComponent(key)}`);
  }

  // -----------------------------------------------------------------
  // internals
  // -----------------------------------------------------------------
  private async request<T>(
    method: 'GET' | 'POST' | 'PATCH' | 'DELETE',
    path: string,
    body?: unknown,
  ): Promise<T> {
    const token = this.tokenSource();
    const res = await this.http.request<T>({
      method,
      url: path,
      data: body,
      headers: { Authorization: `Bearer ${token}` },
    });
    return res.data;
  }

  private isNotFound(err: unknown): boolean {
    const ax = err as AxiosError;
    return !!(ax && ax.isAxiosError && ax.response && ax.response.status === 404);
  }
}
