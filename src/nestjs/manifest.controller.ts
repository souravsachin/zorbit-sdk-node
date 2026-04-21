import { Controller, Get } from '@nestjs/common';
import { Public } from './decorators';

/**
 * Base class for the canonical `GET /api/v1/G/manifest` endpoint that
 * every Zorbit service must expose.
 *
 * Consumed by:
 *   - zorbit-cor-module_registry (announcement handling)
 *   - zorbit-unified-console (nav rendering)
 *
 * Subclasses pass their parsed `zorbit-module-manifest.json` into the
 * constructor. The base returns it verbatim via `GET /`.
 *
 * @example
 *   import { Controller } from '@nestjs/common';
 *   import { ZorbitManifestControllerBase } from '@zorbit-platform/sdk-node';
 *   const manifest = require('../../zorbit-module-manifest.json');
 *
 *   @Controller('api/v1/G/manifest')
 *   export class ManifestController extends ZorbitManifestControllerBase {
 *     constructor() {
 *       super(manifest);
 *     }
 *   }
 */
@Controller()
export class ZorbitManifestControllerBase {
  constructor(protected readonly manifest: Record<string, unknown>) {}

  @Get()
  @Public()
  get(): Record<string, unknown> {
    return this.manifest;
  }
}
