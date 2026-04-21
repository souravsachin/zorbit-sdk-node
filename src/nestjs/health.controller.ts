import { Controller, Get } from '@nestjs/common';
import { Public } from './decorators';

/**
 * Base class for the canonical `GET /api/v1/G/health` endpoint that
 * every Zorbit service must expose.
 *
 * Consuming services extend this class and supply their own service
 * name/version at construction time. No NestJS `@Controller()` decorator
 * is applied on the base class itself — the subclass owns the route
 * prefix so it can be tweaked if needed. In practice this is always
 * `@Controller('api/v1/G/health')`.
 *
 * @example
 *   import { Controller } from '@nestjs/common';
 *   import { ZorbitHealthControllerBase } from '@zorbit-platform/sdk-node';
 *
 *   @Controller('api/v1/G/health')
 *   export class HealthController extends ZorbitHealthControllerBase {
 *     constructor() {
 *       super('zorbit-cor-secrets_vault', '1.0.0');
 *     }
 *   }
 */
@Controller()
export class ZorbitHealthControllerBase {
  constructor(
    protected readonly serviceName: string,
    protected readonly version: string = '1.0.0',
  ) {}

  @Get()
  @Public()
  check(): { status: 'ok'; service: string; version: string; timestamp: string } {
    return {
      status: 'ok',
      service: this.serviceName,
      version: this.version,
      timestamp: new Date().toISOString(),
    };
  }
}
