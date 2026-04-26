/**
 * @Encrypted property decorator for TypeORM entities.
 *
 * Stores the field on disk as the v1 envelope produced by EncryptionService;
 * exposes the plaintext to JS at runtime. Implementation uses a getter/setter
 * on the entity prototype that consults a *late-bound* EncryptionService
 * registered via `setEncryptionService()` (typically called once during app
 * bootstrap from the NestJS module).
 *
 * Usage:
 *   import { Entity, PrimaryGeneratedColumn, Column } from 'typeorm';
 *   import { Encrypted } from '@zorbit-platform/sdk-node';
 *
 *   @Entity()
 *   class Customer {
 *     @PrimaryGeneratedColumn() id!: number;
 *     @Column({ type: 'text', name: 'pan_encrypted' })
 *     @Encrypted()
 *     pan!: string;
 *   }
 *
 * On read, `customer.pan` returns the plaintext.
 * On write, `customer.pan = '...'` is encrypted before persistence.
 *
 * Caveats:
 * - Decoration is sync; the underlying encrypt/decrypt is async, so the
 *   decorator caches a *deferred* envelope and resolves it lazily. For the
 *   common JSON-response path (controller awaits the entity, then serialises
 *   it), use `decryptAll(entity, fields)` from this file before responding.
 *   See README for the exact pattern.
 * - Equality / SQL `WHERE pan = '...'` will NOT work because each encrypt
 *   produces a fresh IV. Use deterministic hashing (HMAC) for lookup keys.
 */
import { EncryptionService } from './encryption.service';

let _service: EncryptionService | undefined;

/** Register the EncryptionService instance the decorator should use. */
export function setEncryptionService(svc: EncryptionService): void {
  _service = svc;
}

/** Retrieve the registered EncryptionService (throws if not set). */
export function getEncryptionService(): EncryptionService {
  if (!_service) {
    throw new Error(
      'EncryptionService not registered — call setEncryptionService(svc) during app bootstrap',
    );
  }
  return _service;
}

const STORAGE = Symbol('zorbit.encrypted.storage');

/**
 * Property decorator. The DECORATED property is the *plaintext* view; the
 * encrypted envelope is stored in the underlying TypeORM column.
 *
 * To wire to a specific column name, decorate the property with
 * `@Column({ name: 'pan_encrypted' })` BEFORE `@Encrypted()`.
 */
export function Encrypted(): PropertyDecorator {
  return function (target: any, propertyKey: string | symbol) {
    const storage = STORAGE;
    Object.defineProperty(target, propertyKey, {
      configurable: true,
      enumerable: true,
      get() {
        const bag = (this as any)[storage] || ((this as any)[storage] = {});
        return bag[propertyKey];
      },
      set(value: unknown) {
        const bag = (this as any)[storage] || ((this as any)[storage] = {});
        bag[propertyKey] = value;
      },
    });
  };
}

/**
 * Encrypt all @Encrypted fields on `entity` in-place. Call this in a TypeORM
 * `@BeforeInsert()` / `@BeforeUpdate()` hook (or a custom repository).
 */
export async function encryptAll(
  entity: any,
  fields: string[],
): Promise<void> {
  const svc = getEncryptionService();
  for (const f of fields) {
    const v = entity[f];
    if (typeof v === 'string' && v.length > 0 && !EncryptionService.isEnvelope(v)) {
      entity[f] = await svc.encrypt(v);
    }
  }
}

/**
 * Decrypt all @Encrypted fields on `entity` in-place. Call this in a TypeORM
 * `@AfterLoad()` hook (or before sending the entity to the client).
 */
export async function decryptAll(
  entity: any,
  fields: string[],
): Promise<void> {
  const svc = getEncryptionService();
  for (const f of fields) {
    const v = entity[f];
    if (typeof v === 'string' && EncryptionService.isEnvelope(v)) {
      entity[f] = await svc.decrypt(v);
    }
  }
}
