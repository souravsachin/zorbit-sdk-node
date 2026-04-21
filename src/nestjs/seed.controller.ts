import { Controller, HttpCode, Logger, Post, UseGuards } from '@nestjs/common';
import { RequirePrivileges } from './decorators';
import { ZorbitJwtGuard } from './zorbit-jwt.guard';
import { ZorbitPrivilegeGuard } from './zorbit-privilege.guard';

/**
 * Result returned by a seeder implementation.
 */
export interface ZorbitSeedResult {
  /** Human-readable summary */
  summary: string;
  /** Count of entities created (optional — seeders may use counts: {...} instead) */
  created?: number;
  /** Count of entities skipped because they already exist */
  skipped?: number;
  /** Structured per-category counts — free-form, caller-defined */
  counts?: Record<string, number>;
  /** Free-form data (test IDs, diagnostic info, etc.) */
  details?: Record<string, unknown>;
}

/**
 * Base class for the canonical `POST /api/v1/G/seed` endpoint.
 *
 * Scaffolded here so every service has a uniform seed entry point.
 * EPIC 11 (new seeding service) will evolve the content strategy —
 * until then, subclasses implement `run()` with whatever bootstrap
 * logic they need (privileges, demo data, test fixtures).
 *
 * Guarded by ZorbitJwtGuard + ZorbitPrivilegeGuard requiring
 * `platform.seed.execute`. Superadmin JWTs carry this privilege.
 *
 * @example
 *   import { Injectable, Controller } from '@nestjs/common';
 *   import { ZorbitSeedControllerBase, ZorbitSeedResult } from '@zorbit-platform/sdk-node';
 *
 *   @Controller('api/v1/G/seed')
 *   export class SeedController extends ZorbitSeedControllerBase {
 *     constructor(private readonly seedService: MySeedService) {
 *       super();
 *     }
 *
 *     protected async run(): Promise<ZorbitSeedResult> {
 *       const { created, skipped } = await this.seedService.seedAll();
 *       return { summary: 'seeded', created, skipped };
 *     }
 *   }
 */
@Controller()
export abstract class ZorbitSeedControllerBase {
  private readonly logger = new Logger(ZorbitSeedControllerBase.name);

  /**
   * Subclasses implement the actual seeding logic here.
   * Called from the `@Post()` handler below.
   */
  protected abstract run(): Promise<ZorbitSeedResult> | ZorbitSeedResult;

  @Post()
  @HttpCode(200)
  @UseGuards(ZorbitJwtGuard, ZorbitPrivilegeGuard)
  @RequirePrivileges('platform.seed.execute')
  async seed(): Promise<ZorbitSeedResult> {
    const started = Date.now();
    try {
      const result = await this.run();
      this.logger.log(
        `Seed completed in ${Date.now() - started}ms: ${result.summary}`,
      );
      return result;
    } catch (err) {
      this.logger.error(
        `Seed failed: ${err instanceof Error ? err.message : String(err)}`,
        err instanceof Error ? err.stack : undefined,
      );
      throw err;
    }
  }
}
