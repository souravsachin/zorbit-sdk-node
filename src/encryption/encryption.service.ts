/**
 * EncryptionService — AES-256-GCM column-level encryption for PII fields.
 *
 * Primary path: app-layer encryption using node `crypto` (portable, fast,
 * no extra round-trip to Postgres). Postgres pgcrypto extension is installed
 * on zs-pg as an emergency / audit decryption path — see
 * `02_repos/zorbit-cli/scripts/post-deploy-bootstrap.sh`.
 *
 * Ciphertext format (URL/JSON-safe base64 envelope):
 *   v1:<keyId>:<base64(iv)>:<base64(authTag)>:<base64(ciphertext)>
 *
 * Key material is read from environment variables. The default key env
 * is `PII_ENCRYPTION_KEY`. Multiple keys can be registered for rotation;
 * the active key is selected by `keyId`. Old keys remain available for
 * decryption only.
 */
import * as crypto from 'crypto';

export interface EncryptionKey {
  /** Stable identifier referenced in the ciphertext envelope (e.g. "k1"). */
  keyId: string;
  /** 32-byte key material. Pass either a Buffer or a base64/hex string. */
  material: Buffer;
}

export interface EncryptionServiceOptions {
  /** Active key used for new encryptions. */
  activeKeyId: string;
  /** All registered keys (active + retired-but-still-decryptable). */
  keys: EncryptionKey[];
  /** Algorithm — currently only aes-256-gcm is supported. */
  algorithm?: 'aes-256-gcm';
}

const ENVELOPE_VERSION = 'v1';

export class EncryptionService {
  private readonly activeKeyId: string;
  private readonly keys: Map<string, Buffer>;
  private readonly algorithm: 'aes-256-gcm';

  constructor(opts: EncryptionServiceOptions) {
    this.algorithm = opts.algorithm ?? 'aes-256-gcm';
    if (this.algorithm !== 'aes-256-gcm') {
      throw new Error(`Unsupported encryption algorithm: ${this.algorithm}`);
    }
    if (!opts.keys || opts.keys.length === 0) {
      throw new Error('EncryptionService requires at least one key');
    }
    this.activeKeyId = opts.activeKeyId;
    this.keys = new Map();
    for (const k of opts.keys) {
      if (k.material.length !== 32) {
        throw new Error(
          `Encryption key '${k.keyId}' must be 32 bytes for aes-256-gcm (got ${k.material.length})`,
        );
      }
      this.keys.set(k.keyId, k.material);
    }
    if (!this.keys.has(this.activeKeyId)) {
      throw new Error(`Active key '${this.activeKeyId}' not found in registered keys`);
    }
  }

  /**
   * Build an EncryptionService from environment variables.
   *
   * - `keyEnv` (default `PII_ENCRYPTION_KEY`) is the active key, base64-encoded
   * - Optional rotation: `PII_ENCRYPTION_KEYS` JSON array of
   *   `[{ keyId, material }]` where material is base64. `PII_ENCRYPTION_ACTIVE_KEY_ID`
   *   selects the active key (defaults to first).
   */
  static fromEnv(opts: { keyEnv?: string } = {}): EncryptionService {
    const keysJson = process.env.PII_ENCRYPTION_KEYS;
    if (keysJson) {
      const parsed = JSON.parse(keysJson) as Array<{ keyId: string; material: string }>;
      const keys = parsed.map((k) => ({
        keyId: k.keyId,
        material: Buffer.from(k.material, 'base64'),
      }));
      const activeKeyId = process.env.PII_ENCRYPTION_ACTIVE_KEY_ID ?? keys[0]?.keyId;
      if (!activeKeyId) {
        throw new Error('PII_ENCRYPTION_KEYS is empty');
      }
      return new EncryptionService({ activeKeyId, keys });
    }
    const env = opts.keyEnv ?? 'PII_ENCRYPTION_KEY';
    const raw = process.env[env];
    if (!raw) {
      throw new Error(`Encryption key env var '${env}' is not set`);
    }
    const material = Buffer.from(raw, 'base64');
    return new EncryptionService({
      activeKeyId: 'k1',
      keys: [{ keyId: 'k1', material }],
    });
  }

  /**
   * Encrypt a plaintext string. Output is the v1 envelope:
   *   v1:<keyId>:<b64(iv)>:<b64(tag)>:<b64(cipher)>
   *
   * Returns synchronously-resolving Promise to keep the API uniform with
   * future async backends (KMS / pgcrypto).
   */
  async encrypt(plain: string): Promise<string> {
    if (typeof plain !== 'string') {
      throw new TypeError('encrypt() requires a string plaintext');
    }
    const key = this.keys.get(this.activeKeyId)!;
    const iv = crypto.randomBytes(12);
    const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
    const ct = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
    const tag = cipher.getAuthTag();
    return [
      ENVELOPE_VERSION,
      this.activeKeyId,
      iv.toString('base64'),
      tag.toString('base64'),
      ct.toString('base64'),
    ].join(':');
  }

  /**
   * Decrypt a v1 envelope back to plaintext. Throws on tampering / wrong key.
   */
  async decrypt(envelope: string): Promise<string> {
    if (typeof envelope !== 'string') {
      throw new TypeError('decrypt() requires a string envelope');
    }
    const parts = envelope.split(':');
    if (parts.length !== 5) {
      throw new Error('Invalid encryption envelope (expected 5 parts)');
    }
    const [version, keyId, ivB64, tagB64, ctB64] = parts;
    if (version !== ENVELOPE_VERSION) {
      throw new Error(`Unsupported envelope version: ${version}`);
    }
    const key = this.keys.get(keyId);
    if (!key) {
      throw new Error(`Unknown encryption keyId: ${keyId}`);
    }
    const iv = Buffer.from(ivB64, 'base64');
    const tag = Buffer.from(tagB64, 'base64');
    const ct = Buffer.from(ctB64, 'base64');
    const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
    decipher.setAuthTag(tag);
    const plain = Buffer.concat([decipher.update(ct), decipher.final()]);
    return plain.toString('utf8');
  }

  /** True if a value looks like a v1 envelope (cheap parse-only check). */
  static isEnvelope(value: unknown): boolean {
    return (
      typeof value === 'string' &&
      value.startsWith(ENVELOPE_VERSION + ':') &&
      value.split(':').length === 5
    );
  }

  /**
   * Generate a new 32-byte key suitable for aes-256-gcm.
   * Returns base64 — assign to `PII_ENCRYPTION_KEY` env.
   */
  static generateKey(): string {
    return crypto.randomBytes(32).toString('base64');
  }
}
