/**
 * ZorbitEncryptionModule — NestJS module that wraps EncryptionService.
 *
 * Usage:
 *   imports: [
 *     ZorbitEncryptionModule.forRoot(),                       // reads env
 *     // OR
 *     ZorbitEncryptionModule.forRoot({
 *       activeKeyId: 'k1',
 *       keys: [{ keyId: 'k1', material: Buffer.from(b64, 'base64') }],
 *     }),
 *   ]
 *
 * NestJS imports are loaded lazily so non-Nest consumers (plain libs) can
 * still import { EncryptionService } without paying the @nestjs/common cost.
 */
import { EncryptionService, EncryptionServiceOptions } from './encryption.service';

/**
 * Provider token for the EncryptionService instance.
 * Use `@Inject(ZORBIT_ENCRYPTION_SERVICE)` if you want to inject by token,
 * or just `EncryptionService` works because it's also a class provider.
 */
export const ZORBIT_ENCRYPTION_SERVICE = 'ZORBIT_ENCRYPTION_SERVICE';

export interface ZorbitEncryptionModuleOptions extends Partial<EncryptionServiceOptions> {
  /** If omitted, read from process.env via EncryptionService.fromEnv(). */
  fromEnv?: { keyEnv?: string };
}

// Lazy-load NestJS to avoid hard dep
let _Module: any;
let _Global: any;
function loadNestjs() {
  if (!_Module) {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const nest = require('@nestjs/common');
    _Module = nest.Module;
    _Global = nest.Global;
  }
  return { Module: _Module, Global: _Global };
}

export class ZorbitEncryptionModule {
  static forRoot(options: ZorbitEncryptionModuleOptions = {}) {
    const { Module, Global } = loadNestjs();

    const service = options.activeKeyId && options.keys
      ? new EncryptionService({
          activeKeyId: options.activeKeyId,
          keys: options.keys,
          algorithm: options.algorithm,
        })
      : EncryptionService.fromEnv(options.fromEnv);

    @Global()
    @Module({
      providers: [
        { provide: EncryptionService, useValue: service },
        { provide: ZORBIT_ENCRYPTION_SERVICE, useValue: service },
      ],
      exports: [EncryptionService, ZORBIT_ENCRYPTION_SERVICE],
    })
    class ZorbitEncryptionDynamicModule {}

    return ZorbitEncryptionDynamicModule;
  }
}
